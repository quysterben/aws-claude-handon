# Aurora Serverless v2 + Drizzle Lambda Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision an Aurora Serverless v2 (PostgreSQL) cluster via CDK and connect it to `app/api`'s Lambdas — API Lambdas via RDS Data API (no VPC), a dedicated migration Lambda via a direct VPC connection (postgres-js) triggered manually.

**Architecture:** `lib/api-stack.ts` provisions an isolated-subnet VPC, an Aurora Serverless v2 cluster (`minCapacity: 0` for auto-pause, Data API enabled), and a Secrets Manager VPC interface endpoint. `HealthFunction` stays outside the VPC and reads/writes via `drizzle-orm/aws-data-api/pg` through a shared `db/client.ts`. A new `MigrateFunction` runs inside the VPC, connects directly via `postgres-js`, and applies `db/migrations/*.sql` with `drizzle-orm/postgres-js/migrator` — invoked manually via a new `yarn db:migrate:remote` script (`aws lambda invoke`), never automatically on deploy.

**Tech Stack:** `aws-cdk-lib` (`aws-ec2`, `aws-rds`), `drizzle-orm` (`aws-data-api/pg` and `postgres-js` drivers), `@aws-sdk/client-rds-data`, `@aws-sdk/client-secrets-manager`, `postgres` (postgres-js) — all in `app/api`, installed via `yarn`.

**Spec:** `docs/superpowers/specs/2026-08-25-aurora-serverless-lambda-connectivity-design.md`

## Global Constraints

- Use `yarn`, not `npm`, for all dependency installs in `app/api`.
- Do not hand-write dependency version numbers in `package.json` — let `yarn add`/`yarn remove` manage them.
- Keep `typescript` pinned to the 5.x line (`.claude/rules/typescript-pnp-compat.md`) — do not touch it.
- After every task, run `yarn build`, `yarn test`, and `yarn cdk synth` from `app/api/` and confirm all three pass (`.claude/rules/api-verification.md`). `yarn cdk synth` is local-only and safe to run freely.
- Never run `yarn cdk deploy`, `yarn cdk bootstrap`, or `yarn db:migrate:remote` against a real cluster — those are manual, user-run, billable steps.
- Never run `git commit` without the user's explicit go-ahead for that specific commit, even though each task ends with a "Commit" step — surface the diff and wait for confirmation.
- No CDK Custom Resource / auto-migration-on-deploy — migration stays a manual, explicit step (`yarn db:migrate:remote`).
- No new business/CRUD routes beyond extending `/health` to prove DB connectivity.
- Aurora engine version must support 0-ACU auto-pause (Aurora PostgreSQL 13.15+/14.12+/15.7+/16.3+) — use `rds.AuroraPostgresEngineVersion.VER_16_13`.

---

### Task 1: Remove local-Postgres dev tooling, add new AWS SDK dependencies

**Files:**
- Delete: `docker-compose.yaml` (repo root)
- Delete: `app/api/.env`
- Delete: `app/api/.env.example`
- Modify: `app/api/drizzle.config.ts`
- Modify: `app/api/package.json`
- Modify: `app/api/yarn.lock` (via `yarn add`/`yarn remove`)

**Interfaces:**
- Produces: `@aws-sdk/client-rds-data` and `@aws-sdk/client-secrets-manager` installed and importable — Task 3 (`db/client.ts`) and Task 5 (`lambda/migrate.ts`) depend on these being present. `drizzle.config.ts` no longer requires `DATABASE_URL` to be set.

- [ ] **Step 1: Delete local-Postgres files**

```bash
rm /Users/apple/Workspace/aws-claude-handon/docker-compose.yaml
rm /Users/apple/Workspace/aws-claude-handon/app/api/.env
rm /Users/apple/Workspace/aws-claude-handon/app/api/.env.example
```

- [ ] **Step 2: Simplify `drizzle.config.ts`**

Replace the full contents of `app/api/drizzle.config.ts` with:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
});
```

- [ ] **Step 3: Remove the `dotenv` dependency**

Run from `app/api/`:

```bash
yarn remove dotenv
```

(No longer needed — nothing reads `.env` anymore.)

- [ ] **Step 4: Add the new AWS SDK dependencies**

Run from `app/api/`:

```bash
yarn add @aws-sdk/client-rds-data @aws-sdk/client-secrets-manager
```

- [ ] **Step 5: Update `package.json` scripts**

Edit `app/api/package.json` so the `"scripts"` block reads:

```json
"scripts": {
  "build": "tsc",
  "test": "jest",
  "cdk": "cdk",
  "db:generate": "drizzle-kit generate",
  "db:studio": "drizzle-kit studio"
}
```

(`db:migrate` is removed — it invoked `drizzle-kit migrate` against `DATABASE_URL`, which no longer exists. Task 5 adds `db:migrate:remote` in its place.)

- [ ] **Step 6: Verify**

Run from `app/api/`:

```bash
yarn install --immutable
yarn build
yarn db:generate
```

Expected: all three exit 0. `yarn db:generate` should report no schema changes (schema is unchanged) rather than erroring — this confirms `drizzle-kit generate` no longer needs a live connection.

- [ ] **Step 7: Commit**

```bash
cd /Users/apple/Workspace/aws-claude-handon
git add docker-compose.yaml app/api/.env app/api/.env.example app/api/drizzle.config.ts app/api/package.json app/api/yarn.lock
git commit -m "chore: drop local-Postgres dev tooling, add RDS/Secrets Manager SDK deps"
```

---

### Task 2: Provision VPC + Aurora Serverless v2 cluster + Secrets Manager VPC endpoint

**Files:**
- Modify: `app/api/lib/api-stack.ts`
- Modify: `app/api/test/api-stack.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (CDK-only).
- Produces: `dbCluster` (`rds.DatabaseCluster`), `dbSecret` (`secretsmanager.ISecret`, `= dbCluster.secret!`), and `vpc` (`ec2.Vpc`) as local `const`s in `ApiStack`'s constructor — Task 4 (`HealthFunction`) and Task 5 (`MigrateFunction`) both reference `dbCluster`, `dbSecret`, and `vpc` by these names.

- [ ] **Step 1: Write the failing test**

Add the following inside the existing `describe("ApiStack", ...)` block in `app/api/test/api-stack.test.ts` (after the existing `it(...)`, before the closing `});` of the `describe`):

```ts
  it("provisions an Aurora Serverless v2 Postgres cluster with Data API enabled, in an isolated-subnet VPC with no NAT gateways", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::EC2::VPC", 1);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);

    template.hasResourceProperties("AWS::RDS::DBCluster", {
      Engine: "aurora-postgresql",
      EnableHttpEndpoint: true,
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 0,
        MaxCapacity: 1,
      },
    });

    template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      VpcEndpointType: "Interface",
      ServiceName: {
        "Fn::Join": [
          "",
          Match.arrayWith([Match.stringLikeRegexp("secretsmanager$")]),
        ],
      },
    });
  });
```

Add `Match` to the existing import from `"aws-cdk-lib/assertions"` at the top of the file:

```ts
import { Match, Template } from "aws-cdk-lib/assertions";
```

- [ ] **Step 2: Run test to verify it fails**

Run from `app/api/`: `yarn test`
Expected: FAIL — no `AWS::RDS::DBCluster` resource exists yet.

- [ ] **Step 3: Implement the VPC, endpoint, and cluster**

In `app/api/lib/api-stack.ts`, add these imports alongside the existing ones:

```ts
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
```

(`Stack` and `CfnOutput` are already imported from `"aws-cdk-lib"` — add `Duration` and `RemovalPolicy` to that same import instead of duplicating it.)

Inside the `ApiStack` constructor, before the `HealthFunction` is created, add:

```ts
    const vpc = new ec2.Vpc(this, "DbVpc", {
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });

    const dbCluster = new rds.DatabaseCluster(this, "DbCluster", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_13,
      }),
      writer: rds.ClusterInstance.serverlessV2("Writer"),
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 1,
      serverlessV2AutoPauseDuration: Duration.minutes(5),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret("appadmin"),
      defaultDatabaseName: "app",
      enableDataApi: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const dbSecret = dbCluster.secret!;
```

- [ ] **Step 4: Run test to verify it passes**

Run from `app/api/`: `yarn test`
Expected: PASS.

- [ ] **Step 5: Run the full verification suite**

Run from `app/api/`:

```bash
yarn build
yarn test
yarn cdk synth
```

Expected: all three exit 0.

- [ ] **Step 6: Commit**

```bash
cd app/api
git add lib/api-stack.ts test/api-stack.test.ts
git commit -m "feat: provision Aurora Serverless v2 cluster with Data API and isolated VPC"
```

---

### Task 3: Shared Data API Drizzle client with resume-retry

**Files:**
- Create: `app/api/db/client.ts`
- Create: `app/api/test/db-client.test.ts`

**Interfaces:**
- Consumes: `app/api/db/schema.ts` (existing `users` table export).
- Produces: `getDb(): AwsDataApiPgDatabase<typeof schema>` and `withResumeRetry<T>(fn: () => Promise<T>): Promise<T>` and `isDatabaseResumingError(error: unknown): boolean`, all exported from `app/api/db/client.ts` — Task 4's `lambda/health.ts` imports `getDb` and `withResumeRetry` from this module. Reads `DB_NAME`, `DB_RESOURCE_ARN`, `DB_SECRET_ARN` from `process.env` (set by Task 2's `dbCluster`/`dbSecret` via Task 4's `HealthFunction` environment).

- [ ] **Step 1: Write the failing test**

Create `app/api/test/db-client.test.ts`:

```ts
import { isDatabaseResumingError, withResumeRetry } from "../db/client";

describe("isDatabaseResumingError", () => {
  it("returns true for an error named DatabaseResumingException", () => {
    const error = new Error("resuming");
    error.name = "DatabaseResumingException";
    expect(isDatabaseResumingError(error)).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isDatabaseResumingError(new Error("boom"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isDatabaseResumingError("boom")).toBe(false);
  });
});

describe("withResumeRetry", () => {
  it("returns the result when the function succeeds on the first try", async () => {
    const fn = jest.fn().mockResolvedValue("ok");

    await expect(withResumeRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once after a DatabaseResumingException and returns the retry's result", async () => {
    jest.useFakeTimers();
    const resumingError = new Error("resuming");
    resumingError.name = "DatabaseResumingException";
    const fn = jest
      .fn()
      .mockRejectedValueOnce(resumingError)
      .mockResolvedValueOnce("ok");

    const promise = withResumeRetry(fn);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it("rethrows a non-resuming error without retrying", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("boom"));

    await expect(withResumeRetry(fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `app/api/`: `yarn test`
Expected: FAIL with a module-not-found error for `../db/client`.

- [ ] **Step 3: Implement `db/client.ts`**

Create `app/api/db/client.ts`:

```ts
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import * as schema from "./schema";

const RESUME_RETRY_DELAY_MS = 15_000;

export function isDatabaseResumingError(error: unknown): boolean {
  return error instanceof Error && error.name === "DatabaseResumingException";
}

export async function withResumeRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isDatabaseResumingError(error)) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, RESUME_RETRY_DELAY_MS));
    return fn();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb() {
  if (!db) {
    const client = new RDSDataClient({});
    db = drizzle(client, {
      database: requireEnv("DB_NAME"),
      resourceArn: requireEnv("DB_RESOURCE_ARN"),
      secretArn: requireEnv("DB_SECRET_ARN"),
      schema,
    });
  }
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run from `app/api/`: `yarn test`
Expected: PASS.

- [ ] **Step 5: Run the full verification suite**

Run from `app/api/`:

```bash
yarn build
yarn test
yarn cdk synth
```

Expected: all three exit 0.

- [ ] **Step 6: Commit**

```bash
cd app/api
git add db/client.ts test/db-client.test.ts
git commit -m "feat: add shared Data API Drizzle client with resume-retry"
```

---

### Task 4: Wire `HealthFunction` to Data API and extend `/health`

**Files:**
- Modify: `app/api/lib/api-stack.ts`
- Modify: `app/api/lambda/health.ts`
- Modify: `app/api/test/api-stack.test.ts`

**Interfaces:**
- Consumes: `dbCluster`, `dbSecret` from Task 2; `getDb`, `withResumeRetry` from Task 3's `db/client.ts`.
- Produces: `GET /health` response body now includes a `db` field (`"ok" | "unreachable"`) — no other task depends on this response shape.

- [ ] **Step 1: Write the failing test**

Add the following inside the existing `describe("ApiStack", ...)` block in `app/api/test/api-stack.test.ts`:

```ts
  it("grants HealthFunction Data API access without placing it in a VPC", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Environment: {
        Variables: Match.objectLike({
          DB_NAME: "app",
          DB_RESOURCE_ARN: Match.anyValue(),
          DB_SECRET_ARN: Match.anyValue(),
        }),
      },
    });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["rds-data:ExecuteStatement"]),
          }),
        ]),
      },
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run from `app/api/`: `yarn test`
Expected: FAIL — `HealthFunction` has no `Environment.Variables` and no `rds-data:ExecuteStatement` grant yet.

- [ ] **Step 3: Wire the grant and environment variables**

In `app/api/lib/api-stack.ts`, modify the existing `healthFunction` declaration (currently just `entry`, `handler`, `runtime`) to add `environment`, and add the grant call immediately after it:

```ts
    const healthFunction = new NodejsFunction(this, "HealthFunction", {
      entry: path.join(__dirname, "..", "lambda", "health.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      environment: {
        DB_RESOURCE_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_NAME: "app",
      },
    });

    dbCluster.grantDataApiAccess(healthFunction);
```

- [ ] **Step 4: Run test to verify it passes**

Run from `app/api/`: `yarn test`
Expected: PASS.

- [ ] **Step 5: Extend the `/health` handler to check the database**

Replace the full contents of `app/api/lambda/health.ts`:

```ts
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { sql } from "drizzle-orm";
import { getDb, withResumeRetry } from "../db/client";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  let db: "ok" | "unreachable" = "ok";
  try {
    await withResumeRetry(() => getDb().execute(sql`SELECT 1`));
  } catch {
    db = "unreachable";
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "ok", db }),
  };
};
```

- [ ] **Step 6: Run the full verification suite**

Run from `app/api/`:

```bash
yarn build
yarn test
yarn cdk synth
```

Expected: all three exit 0.

- [ ] **Step 7: Commit**

```bash
cd app/api
git add lib/api-stack.ts lambda/health.ts test/api-stack.test.ts
git commit -m "feat: connect HealthFunction to Aurora via RDS Data API"
```

---

### Task 5: Migration Lambda in the Aurora VPC + manual remote-invoke script

**Files:**
- Create: `app/api/lambda/migrate.ts`
- Modify: `app/api/lib/api-stack.ts`
- Modify: `app/api/test/api-stack.test.ts`
- Modify: `app/api/package.json`

**Interfaces:**
- Consumes: `vpc`, `dbCluster`, `dbSecret` from Task 2; existing `db/migrations/*.sql` and `db/schema.ts`.
- Produces: `MigrateFunction` Lambda deployed with a fixed name `"api-migrate"`; `yarn db:migrate:remote` script in `package.json` that invokes it by that fixed name — nothing later depends on this beyond the developer running it manually.

- [ ] **Step 1: Write the failing test**

Add the following inside the existing `describe("ApiStack", ...)` block in `app/api/test/api-stack.test.ts`:

```ts
  it("runs the migration Lambda inside the Aurora VPC with a fixed name and Secrets Manager read access", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "api-migrate",
      VpcConfig: Match.objectLike({
        SubnetIds: Match.anyValue(),
      }),
    });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "secretsmanager:GetSecretValue",
          }),
        ]),
      },
    });

    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      FromPort: 5432,
      ToPort: 5432,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run from `app/api/`: `yarn test`
Expected: FAIL — no Lambda named `api-migrate` exists yet.

- [ ] **Step 3: Implement `lambda/migrate.ts`**

Create `app/api/lambda/migrate.ts`:

```ts
import type { Handler } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

interface DbSecret {
  username: string;
  password: string;
}

const CONNECT_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 5_000;

export const handler: Handler = async () => {
  const secret = await fetchSecret(requireEnv("DB_SECRET_ARN"));

  const sql = postgres({
    host: requireEnv("DB_HOST"),
    port: Number(requireEnv("DB_PORT")),
    database: requireEnv("DB_NAME"),
    username: secret.username,
    password: secret.password,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    max: 1,
  });

  try {
    await runMigrationsWithRetry(sql);
    return { applied: true };
  } finally {
    await sql.end({ timeout: 5 });
  }
};

async function runMigrationsWithRetry(sql: postgres.Sql): Promise<void> {
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: "./db/migrations" });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    await migrate(db, { migrationsFolder: "./db/migrations" });
  }
}

async function fetchSecret(secretArn: string): Promise<DbSecret> {
  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!response.SecretString) {
    throw new Error(`Secret ${secretArn} has no SecretString`);
  }
  return JSON.parse(response.SecretString) as DbSecret;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}
```

- [ ] **Step 4: Add `MigrateFunction` to the CDK stack**

In `app/api/lib/api-stack.ts`, after the `HealthFunction`/`dbCluster.grantDataApiAccess(...)` block, add:

```ts
    const migrateFunction = new NodejsFunction(this, "MigrateFunction", {
      entry: path.join(__dirname, "..", "lambda", "migrate.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      functionName: "api-migrate",
      timeout: Duration.seconds(60),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      environment: {
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbCluster.clusterEndpoint.port.toString(),
        DB_NAME: "app",
        DB_SECRET_ARN: dbSecret.secretArn,
      },
      bundling: {
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [`cp -r ${inputDir}/db/migrations ${outputDir}/db/migrations`];
          },
          beforeInstall(_inputDir: string, _outputDir: string): string[] {
            return [];
          },
        },
      },
    });

    dbSecret.grantRead(migrateFunction);
    dbCluster.connections.allowDefaultPortFrom(
      migrateFunction,
      "Allow migration Lambda to reach Aurora",
    );
```

- [ ] **Step 5: Run test to verify it passes**

Run from `app/api/`: `yarn test`
Expected: PASS.

- [ ] **Step 6: Add the manual remote-migrate script**

Edit `app/api/package.json` so the `"scripts"` block reads:

```json
"scripts": {
  "build": "tsc",
  "test": "jest",
  "cdk": "cdk",
  "db:generate": "drizzle-kit generate",
  "db:studio": "drizzle-kit studio",
  "db:migrate:remote": "aws lambda invoke --function-name api-migrate --cli-binary-format raw-in-base64-out --payload '{}' /tmp/api-migrate-output.json && cat /tmp/api-migrate-output.json"
}
```

- [ ] **Step 7: Run the full verification suite**

Run from `app/api/`:

```bash
yarn build
yarn test
yarn cdk synth
```

Expected: all three exit 0. (`yarn db:migrate:remote` is NOT run — it requires a deployed cluster and real AWS credentials; it's a manual, user-run step.)

- [ ] **Step 8: Commit**

```bash
cd app/api
git add lambda/migrate.ts lib/api-stack.ts test/api-stack.test.ts package.json
git commit -m "feat: add VPC migration Lambda and manual db:migrate:remote script"
```

---

### Task 6: Final verification

**Files:** none created or modified — verification only.

**Interfaces:** none (terminal task).

- [ ] **Step 1: Run the full standard verification suite**

Run from `app/api/`:

```bash
yarn build
yarn test
yarn cdk synth
```

Expected: all three exit 0, with the final `yarn test` run showing all `ApiStack` and `db/client` tests passing (original `/health` route test, the three new `ApiStack` tests from Tasks 2/4/5, and the four `db/client` tests from Task 3).

- [ ] **Step 2: Confirm no local-Postgres artifacts remain**

Run from the repo root:

```bash
git status --short
ls app/api/.env app/api/.env.example docker-compose.yaml 2>&1
```

Expected: the three paths report "No such file or directory"; `git status --short` shows no unexpected untracked files.

- [ ] **Step 3: Report to the user**

Summarize: cluster/VPC/endpoint provisioned (not deployed), `HealthFunction` wired to Data API, `MigrateFunction` wired for manual VPC-based migration, all local verification passing. Remind the user that `yarn cdk deploy` and `yarn db:migrate:remote` are manual, user-run, billable next steps — not run by the assistant.
