# Cognito Auth: Register + Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /auth/register` and `POST /auth/login` to `app/api`, backed by a new Cognito User Pool, with a Postgres `users` shadow table kept in sync so future business tables can FK to it.

**Architecture:** One `NodejsFunction` per route (`RegisterFunction`, `LoginFunction`), same pattern as the existing `HealthFunction`. Register calls Cognito Admin APIs to create an already-confirmed user, then writes a profile row to Postgres via the existing Data API `getDb()` client. Login calls Cognito's `InitiateAuth` (`USER_PASSWORD_AUTH`) and returns the resulting tokens; it never touches Postgres.

**Tech Stack:** AWS CDK (`aws-cdk-lib/aws-cognito`, `aws-cdk-lib/aws-iam`), `@aws-sdk/client-cognito-identity-provider`, Drizzle ORM (`drizzle-orm/aws-data-api/pg`, already wired via `db/client.ts`), Jest + `aws-cdk-lib/assertions`.

**Spec:** `docs/superpowers/specs/2026-08-26-cognito-auth-register-login-design.md`

## Global Constraints

- All new Lambdas use `Runtime.NODEJS_24_X` (per `.claude/rules/lambda-runtime-freshness.md`).
- Use `yarn`, never `npm`, for dependency installs (`app/api` is Yarn Berry, `node-modules` linker).
- Keep `typescript` pinned to the 5.x line — do not touch its version (`.claude/rules/typescript-pnp-compat.md`).
- After every task, run `yarn build && yarn test && yarn cdk synth` from `app/api/` and confirm all three pass before moving to the next task (`.claude/rules/api-verification.md`). Never run `yarn cdk deploy` or `yarn cdk bootstrap`.
- **Never commit or create a branch without explicit user permission.** Each task below ends with "pause for approval" instead of an automatic `git commit` — stage the changes and ask the user before committing, per this repo's git workflow rule.

---

### Task 1: Add the Cognito SDK dependency

**Files:**
- Modify: `app/api/package.json`

**Interfaces:**
- Produces: `@aws-sdk/client-cognito-identity-provider` importable by later tasks — `CognitoIdentityProviderClient`, `AdminCreateUserCommand`, `AdminSetUserPasswordCommand`, `InitiateAuthCommand`, `UsernameExistsException`, `NotAuthorizedException`, `UserNotFoundException`.

- [ ] **Step 1: Install the dependency**

Run from `app/api/`:

```bash
yarn add @aws-sdk/client-cognito-identity-provider@^3.1117.0
```

This matches the version range already used by `@aws-sdk/client-rds-data` and `@aws-sdk/client-secrets-manager` in `app/api/package.json`.

- [ ] **Step 2: Verify the install**

Run: `yarn build`
Expected: passes unchanged (no new code uses the package yet).

- [ ] **Step 3: Pause for approval**

Show the user the `package.json` / `yarn.lock` diff and ask before committing. Do not run `git commit`.

---

### Task 2: Repurpose the `users` table for Cognito-linked identity

**Files:**
- Modify: `app/api/db/schema.ts`
- Create: `app/api/db/migrations/000X_<generated>.sql` (name chosen by `drizzle-kit generate`)

**Interfaces:**
- Produces: `users` table shape — `{ id: text (PK, Cognito sub), email: text (unique), name: text, role: userRoleEnum ("ADMIN"|"USER", default "USER"), createdAt: timestamp }`. `passwordHash` and `updatedAt` no longer exist. Consumed by Task 4's Postgres insert.

- [ ] **Step 1: Edit `db/schema.ts`**

Replace the file's contents with:

```ts
import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "USER"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRoleEnum("role").notNull().default("USER"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

This drops `serial` (no longer used — `id` is now the Cognito `sub`), `passwordHash`, and `updatedAt`.

- [ ] **Step 2: Generate the migration**

Run from `app/api/`:

```bash
yarn db:generate
```

This diffs the new schema against `db/migrations/meta/_journal.json` (no live DB connection needed) and writes a new SQL file. If `drizzle-kit` asks an interactive question about whether `id`'s type change is a rename vs. a drop+recreate, answer that it is **not** a rename (it's dropping the old serial-based `id` semantics and introducing a text `id`) — same for `password_hash`/`updated_at`, which are drops, not renames to anything.

- [ ] **Step 3: Verify the generated migration**

Run: `ls app/api/db/migrations/` and read the new file. Confirm it contains an `ALTER TABLE "users"` (or drop/recreate) that removes `password_hash`, removes `updated_at`, and changes `id` to `text` — and does **not** touch `email`, `name`, `role`, or `created_at`.

- [ ] **Step 4: Verify build**

Run: `yarn build`
Expected: passes (no code references the removed columns yet).

- [ ] **Step 5: Pause for approval**

Show the user the schema + migration diff and ask before committing.

---

### Task 3: `computeSecretHash` helper (TDD)

**Files:**
- Create: `app/api/lambda/cognito-secret-hash.ts`
- Test: `app/api/test/cognito-secret-hash.test.ts`

**Interfaces:**
- Produces: `computeSecretHash(username: string, clientId: string, clientSecret: string): string` — consumed by Task 5's login handler.

- [ ] **Step 1: Write the failing test**

Create `app/api/test/cognito-secret-hash.test.ts`:

```ts
import { computeSecretHash } from "../lambda/cognito-secret-hash";

describe("computeSecretHash", () => {
  it("matches the known HMAC-SHA256(username + clientId, clientSecret) base64 value", () => {
    const result = computeSecretHash(
      "user@example.com",
      "abc123clientid",
      "supersecretvalue",
    );

    expect(result).toBe("6Wr8aWULmfiprZMVn//q4dYQgvpozKPQriA2fCOTLmI=");
  });

  it("produces different hashes for different usernames", () => {
    const hashA = computeSecretHash(
      "a@example.com",
      "abc123clientid",
      "supersecretvalue",
    );
    const hashB = computeSecretHash(
      "b@example.com",
      "abc123clientid",
      "supersecretvalue",
    );

    expect(hashA).not.toBe(hashB);
  });
});
```

The golden value in the first test was independently computed via `openssl dgst -sha256 -hmac "supersecretvalue" -binary | base64` over the literal string `user@example.comabc123clientid` — it does not depend on the implementation under test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test cognito-secret-hash -- --watchAll=false` (from `app/api/`)
Expected: FAIL — `Cannot find module '../lambda/cognito-secret-hash'`.

- [ ] **Step 3: Implement the helper**

Create `app/api/lambda/cognito-secret-hash.ts`:

```ts
import { createHmac } from "crypto";

export function computeSecretHash(
  username: string,
  clientId: string,
  clientSecret: string,
): string {
  return createHmac("sha256", clientSecret)
    .update(username + clientId)
    .digest("base64");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test cognito-secret-hash -- --watchAll=false`
Expected: PASS (2 tests).

- [ ] **Step 5: Pause for approval**

Show the user the new files and ask before committing.

---

### Task 4: Register Lambda handler

**Files:**
- Create: `app/api/lambda/auth-register.ts`

**Interfaces:**
- Consumes: `users` table from Task 2 (`../db/schema`); `getDb()`, `withResumeRetry()` from existing `../db/client` (unchanged); `CognitoIdentityProviderClient`, `AdminCreateUserCommand`, `AdminSetUserPasswordCommand`, `UsernameExistsException` from Task 1's dependency. Reads env vars `COGNITO_USER_POOL_ID`, `DB_RESOURCE_ARN`, `DB_SECRET_ARN`, `DB_NAME` (set by Task 6's CDK changes).
- Produces: `handler: APIGatewayProxyHandlerV2` — the `NodejsFunction` entry point Task 6 wires to `POST /auth/register`.

No dedicated unit test for this handler — matches this project's existing convention (`lambda/health.ts` has no unit test either; correctness here is covered by `yarn build`'s type-check and by Task 6's CDK assertions that the function exists with the right grants/env vars). Manual end-to-end verification after a real deploy is a follow-up for the user, not this plan.

- [ ] **Step 1: Write the handler**

Create `app/api/lambda/auth-register.ts`:

```ts
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { getDb, withResumeRetry } from "../db/client";
import { users } from "../db/schema";

const cognito = new CognitoIdentityProviderClient({});

type Role = "ADMIN" | "USER";
const VALID_ROLES: Role[] = ["ADMIN", "USER"];

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let payload: {
    email?: unknown;
    password?: unknown;
    name?: unknown;
    role?: unknown;
  };
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { message: "Invalid JSON body" });
  }

  const { email, password, name, role } = payload;

  if (typeof email !== "string" || email.length === 0) {
    return jsonResponse(400, { message: "email is required" });
  }
  if (typeof password !== "string" || password.length === 0) {
    return jsonResponse(400, { message: "password is required" });
  }
  if (typeof name !== "string" || name.length === 0) {
    return jsonResponse(400, { message: "name is required" });
  }
  const resolvedRole: Role = role === undefined ? "USER" : (role as Role);
  if (!VALID_ROLES.includes(resolvedRole)) {
    return jsonResponse(400, { message: "role must be ADMIN or USER" });
  }

  const userPoolId = requireEnv("COGNITO_USER_POOL_ID");

  let sub: string;
  try {
    const createResult = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: name },
          { Name: "custom:role", Value: resolvedRole },
        ],
      }),
    );

    const subAttribute = createResult.User?.Attributes?.find(
      (attr) => attr.Name === "sub",
    );
    if (!subAttribute?.Value) {
      throw new Error("Cognito did not return a sub attribute");
    }
    sub = subAttribute.Value;

    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: email,
        Password: password,
        Permanent: true,
      }),
    );
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      return jsonResponse(409, { message: "email is already registered" });
    }
    console.error("Cognito register failed", error);
    return jsonResponse(500, { message: "registration failed" });
  }

  try {
    await withResumeRetry(async () => {
      await getDb()
        .insert(users)
        .values({ id: sub, email, name, role: resolvedRole });
    });
  } catch (error) {
    console.error("Postgres profile insert failed after Cognito create", {
      sub,
      error,
    });
    return jsonResponse(500, { message: "registration failed" });
  }

  return jsonResponse(201, { id: sub, email, name, role: resolvedRole });
};
```

- [ ] **Step 2: Verify it compiles**

Run: `yarn build` (from `app/api/`)
Expected: passes — this file type-checks standalone even before Task 6 wires it into the CDK stack (`tsconfig.json` has no `include` restriction, so `tsc` picks up every `.ts` file under `app/api/`).

- [ ] **Step 3: Pause for approval**

Show the user the new file and ask before committing.

---

### Task 5: Login Lambda handler

**Files:**
- Create: `app/api/lambda/auth-login.ts`

**Interfaces:**
- Consumes: `computeSecretHash` from Task 3 (`./cognito-secret-hash`); `CognitoIdentityProviderClient`, `InitiateAuthCommand`, `NotAuthorizedException`, `UserNotFoundException` from Task 1's dependency. Reads env vars `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET` (set by Task 6's CDK changes).
- Produces: `handler: APIGatewayProxyHandlerV2` — the `NodejsFunction` entry point Task 6 wires to `POST /auth/login`.

Same testing note as Task 4: no dedicated unit test, consistent with `lambda/health.ts`'s existing coverage level; verified via `yarn build` and Task 6's CDK assertions.

- [ ] **Step 1: Write the handler**

Create `app/api/lambda/auth-login.ts`:

```ts
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  NotAuthorizedException,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { computeSecretHash } from "./cognito-secret-hash";

const cognito = new CognitoIdentityProviderClient({});

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let payload: { email?: unknown; password?: unknown };
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { message: "Invalid JSON body" });
  }

  const { email, password } = payload;
  if (typeof email !== "string" || email.length === 0) {
    return jsonResponse(400, { message: "email is required" });
  }
  if (typeof password !== "string" || password.length === 0) {
    return jsonResponse(400, { message: "password is required" });
  }

  const clientId = requireEnv("COGNITO_CLIENT_ID");
  const clientSecret = requireEnv("COGNITO_CLIENT_SECRET");
  const secretHash = computeSecretHash(email, clientId, clientSecret);

  try {
    const result = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
          SECRET_HASH: secretHash,
        },
      }),
    );

    const tokens = result.AuthenticationResult;
    if (!tokens?.AccessToken || !tokens.IdToken || !tokens.RefreshToken) {
      throw new Error("Cognito did not return authentication tokens");
    }

    return jsonResponse(200, {
      idToken: tokens.IdToken,
      accessToken: tokens.AccessToken,
      refreshToken: tokens.RefreshToken,
      expiresIn: tokens.ExpiresIn,
    });
  } catch (error) {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof UserNotFoundException
    ) {
      return jsonResponse(401, { message: "invalid email or password" });
    }
    console.error("Cognito login failed", error);
    return jsonResponse(500, { message: "login failed" });
  }
};
```

- [ ] **Step 2: Verify it compiles**

Run: `yarn build`
Expected: passes.

- [ ] **Step 3: Pause for approval**

Show the user the new file and ask before committing.

---

### Task 6: Cognito infra + routes in `ApiStack` (TDD)

**Files:**
- Modify: `app/api/lib/api-stack.ts`
- Modify: `app/api/test/api-stack.test.ts`

**Interfaces:**
- Consumes: `lambda/auth-register.ts` and `lambda/auth-login.ts` (Tasks 4–5, as `NodejsFunction` `entry` paths); existing `dbCluster`, `dbSecret`, `httpApi` locals already in `api-stack.ts`.
- Produces: `UserPool`, `UserPoolClient` (secret-enabled, `USER_PASSWORD_AUTH`), `RegisterFunction`, `LoginFunction` CDK constructs; routes `POST /auth/register`, `POST /auth/login`; `CfnOutput`s `UserPoolId`, `UserPoolClientId`.

Note: `RegisterFunction` only needs `COGNITO_USER_POOL_ID` — `AdminCreateUser`/`AdminSetUserPassword` are IAM-authorized admin APIs and don't take a client ID or `SECRET_HASH`, so no `COGNITO_CLIENT_ID` env var is added to it (only `LoginFunction` needs client ID/secret, for `InitiateAuth`'s `SECRET_HASH`).

- [ ] **Step 1: Write the failing assertions**

In `app/api/test/api-stack.test.ts`:

1. In the **first** `it(...)` block ("creates an HTTP API with a GET /health route backed by a Lambda"), delete this line — it will be superseded by a dedicated Lambda-count assertion below, and adding two new functions in this task would otherwise make it fail for an unrelated reason:

```ts
    template.resourceCountIs("AWS::Lambda::Function", 2);
```

2. Add two new `it(...)` blocks inside the existing `describe("ApiStack", ...)`:

```ts
  it("provisions a Cognito User Pool with a secret-enabled app client supporting USER_PASSWORD_AUTH and a custom role attribute", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: Match.objectLike({
        AllowAdminCreateUserOnly: true,
      }),
      Schema: Match.arrayWith([
        Match.objectLike({
          AttributeDataType: "String",
          Name: "role",
        }),
      ]),
    });

    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: true,
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_PASSWORD_AUTH"]),
    });
  });

  it("wires POST /auth/register and POST /auth/login to dedicated Lambdas outside the VPC", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Lambda::Function", 4);

    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /auth/register",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /auth/login",
    });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "cognito-idp:AdminCreateUser",
              "cognito-idp:AdminSetUserPassword",
            ]),
          }),
        ]),
      },
    });

    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          COGNITO_USER_POOL_ID: Match.anyValue(),
          DB_RESOURCE_ARN: Match.anyValue(),
        }),
      }),
      VpcConfig: Match.absent(),
    });

    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          COGNITO_CLIENT_ID: Match.anyValue(),
          COGNITO_CLIENT_SECRET: Match.anyValue(),
        }),
      }),
      VpcConfig: Match.absent(),
    });
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `yarn test -- --watchAll=false` (from `app/api/`)
Expected: the two new tests FAIL (no `AWS::Cognito::UserPool` / no `/auth/*` routes yet); all pre-existing tests still PASS (the stale count assertion was removed in Step 1, so nothing else regresses).

- [ ] **Step 3: Implement the CDK changes**

In `app/api/lib/api-stack.ts`:

Add imports (alongside the existing ones):

```ts
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
```

After the `dbSecret` declaration and before `const httpApi = ...`, add:

```ts
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false,
      standardAttributes: {
        fullname: { required: false, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPoolClient = userPool.addClient("UserPoolClient", {
      generateSecret: true,
      authFlows: { userPassword: true },
    });
```

After the existing `dbCluster.grantDataApiAccess(healthFunction);` line, add the two new functions:

```ts
    const registerFunction = new NodejsFunction(this, "RegisterFunction", {
      entry: path.join(__dirname, "..", "lambda", "auth-register.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      timeout: Duration.seconds(25),
      environment: {
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        DB_RESOURCE_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_NAME: "app",
      },
    });

    dbCluster.grantDataApiAccess(registerFunction);
    registerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    const loginFunction = new NodejsFunction(this, "LoginFunction", {
      entry: path.join(__dirname, "..", "lambda", "auth-login.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      timeout: Duration.seconds(25),
      environment: {
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_CLIENT_SECRET: userPoolClient.userPoolClientSecret.unsafeUnwrap(),
      },
    });
```

Extend the existing `httpApi.addRoutes({...})` call for `/health` with two more calls right after it:

```ts
    httpApi.addRoutes({
      path: "/auth/register",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "RegisterIntegration",
        registerFunction,
      ),
    });

    httpApi.addRoutes({
      path: "/auth/login",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("LoginIntegration", loginFunction),
    });
```

After the existing `CfnOutput`s, add:

```ts
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test -- --watchAll=false`
Expected: all tests PASS, including the two new ones.

- [ ] **Step 5: Full verification sweep**

Run, from `app/api/`:

```bash
yarn build
yarn test
yarn cdk synth
```

Expected: all three pass with no errors. `yarn cdk synth` output should show `AWS::Cognito::UserPool`, `AWS::Cognito::UserPoolClient`, and 4 `AWS::Lambda::Function` resources (Health, Migrate, Register, Login).

- [ ] **Step 6: Pause for approval**

Show the user the full diff (`lib/api-stack.ts`, `test/api-stack.test.ts`) and ask before committing. Remind them that `yarn cdk deploy` (to actually provision the User Pool and routes) is their manual, billable step to run — not something to run automatically.

---

## After all tasks

Once every task above is approved and (if the user chooses) committed, the API exposes `POST /auth/register` and `POST /auth/login` against a not-yet-deployed Cognito User Pool. Deploying (`yarn cdk deploy`) and manually exercising both endpoints against a real pool is the user's follow-up step — this plan does not include it, per the repo rule that the assistant never runs `cdk deploy`.
