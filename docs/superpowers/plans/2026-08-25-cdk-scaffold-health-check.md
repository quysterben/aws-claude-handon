# CDK Scaffold + Health Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Scaffold `app/api` from a bare `package.json` into a working AWS CDK app (Lambda + API Gateway HTTP API v2) with a single `GET /health` route backed by a Lambda that returns `{"status":"ok"}`.

**Architecture:** One CDK stack (`ApiStack`) provisions an HTTP API (v2) and one `NodejsFunction` per route, wired via `HttpLambdaIntegration`. Only one route exists for now: `GET /health` → `lambda/health.ts`. `bin/api.ts` is the CDK app entry point that instantiates the stack. `esbuild` bundles Lambda code automatically at synth time via `NodejsFunction` — no separate build step for Lambda code.

**Tech Stack:** TypeScript, AWS CDK v2 (`aws-cdk-lib`, `aws-cdk` CLI, `constructs`), `aws-cdk-lib/aws-lambda-nodejs` (`NodejsFunction`), `@aws-cdk/aws-apigatewayv2-integrations`-equivalent (`aws-cdk-lib/aws-apigatewayv2-integrations` `HttpLambdaIntegration`), `aws-cdk-lib/aws-apigatewayv2` (`HttpApi`), Jest + `aws-cdk-lib/assertions` for stack tests, Yarn Berry (PnP) for package management.

**Spec:** `CLAUDE.md` (repo root) — section "`app/api/` — Lambda + API Gateway (AWS CDK)". No separate design doc exists yet at the path CLAUDE.md references (`docs/superpowers/specs/2026-08-25-lambda-apigateway-cdk-design.md`); CLAUDE.md's own "Architecture" summary is the authoritative spec for this plan.

## Global Constraints

- Use `yarn`, not `npm`, for all dependency installs (Yarn 4 PnP project — `.pnp.cjs` / `.yarn/` already present).
- Layout must match CLAUDE.md's "Expected layout": `bin/api.ts` (CDK entry), `lib/api-stack.ts` (stack def), `lambda/*.ts` (handlers), `test/*.test.ts` (CDK assertions via `aws-cdk-lib/assertions`), `cdk.json`.
- `package.json` scripts must include: `build` (`tsc`), `test` (`jest`), `cdk` (`cdk`).
- One Lambda per route, using `NodejsFunction` from `aws-cdk-lib/aws-lambda-nodejs` (esbuild-bundled automatically — no manual bundling step).
- Do not run `cdk bootstrap` or `cdk deploy` — those are manual, user-run, billable operations against a real AWS account. This plan only covers `cdk synth` (local, no AWS calls) and unit tests.

---

### Task 1: Add CDK dependencies and package.json scripts

**Files:**
- Modify: `app/api/package.json`

**Interfaces:**
- Produces: `build`, `test`, `cdk` npm scripts that later tasks (and the engineer running `yarn build` / `yarn test`) rely on.

- [x] **Step 1: Add runtime and dev dependencies via yarn**

Run from `app/api/`:

```bash
yarn add aws-cdk-lib constructs
yarn add -D typescript ts-node aws-cdk jest ts-jest @types/jest @types/node @types/aws-lambda esbuild
```

`esbuild` is required as a dev dependency for `NodejsFunction` to bundle Lambda code at synth time. `ts-jest` + `@types/jest` are for running CDK assertion tests written in TypeScript.

- [x] **Step 2: Add scripts to package.json**

Edit `app/api/package.json` so it reads:

```json
{
  "name": "api",
  "packageManager": "yarn@4.12.0",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "cdk": "cdk"
  },
  "devDependencies": {
    "...": "left as populated by yarn add in Step 1"
  },
  "dependencies": {
    "...": "left as populated by yarn add in Step 1"
  }
}
```

Do not hand-write the dependency version numbers — keep whatever `yarn add` wrote in Step 1, only add the top-level `"scripts"` key.

- [x] **Step 3: Verify install succeeded**

Run: `yarn install --immutable` (from `app/api/`)
Expected: exits 0, no PnP resolution errors.

- [x] **Step 4: Commit**

```bash
cd app/api
git add package.json yarn.lock .pnp.cjs .yarn
git commit -m "chore: add CDK toolchain dependencies and scripts"
```

---

### Task 2: TypeScript and CDK configuration

**Files:**
- Create: `app/api/tsconfig.json`
- Create: `app/api/cdk.json`
- Create: `app/api/.gitignore` additions (modify existing `app/api/.gitignore`)

**Interfaces:**
- Consumes: `build` script from Task 1 (`tsc`), which reads `tsconfig.json`.
- Produces: `cdk.json` `app` entry (`npx ts-node --prefer-ts-exts bin/api.ts`) that the `cdk` script from Task 1 invokes; `tsconfig.json` compiler settings that Tasks 3–5's `.ts` files must satisfy (strict mode, CommonJS modules, target ES2020).

- [x] **Step 1: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "declaration": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": false,
    "inlineSourceMap": true,
    "inlineSources": true,
    "experimentalDecorators": true,
    "strictPropertyInitialization": false,
    "typeRoots": ["./node_modules/@types"],
    "outDir": "dist",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "exclude": ["node_modules", "cdk.out", "dist"]
}
```

- [x] **Step 2: Write cdk.json**

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/api.ts",
  "watch": {
    "include": ["**"],
    "exclude": [
      "README.md",
      "cdk*.json",
      "**/*.d.ts",
      "**/*.js",
      "tsconfig.json",
      "package*.json",
      "yarn.lock",
      "node_modules",
      "dist",
      "test"
    ]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": ["aws", "aws-cn"],
    "@aws-cdk/aws-apigateway:disableCloudWatchRole": true
  }
}
```

- [x] **Step 3: Append build artifacts to .gitignore**

Add to `app/api/.gitignore`:

```

# CDK / TypeScript build output
*.d.ts
*.js
!jest.config.js
dist
cdk.out
```

- [x] **Step 4: Commit**

```bash
cd app/api
git add tsconfig.json cdk.json .gitignore
git commit -m "chore: add TypeScript and CDK configuration"
```

---

### Task 3: Health check Lambda handler

**Files:**
- Create: `app/api/lambda/health.ts`

**Interfaces:**
- Produces: `export const handler: APIGatewayProxyHandlerV2` — an async Lambda handler used by Task 4's `lib/api-stack.ts` as the target for `NodejsFunction`'s `entry` (`lambda/health.ts`) and `handler` (`"handler"`).

- [x] **Step 1: Write the handler**

```typescript
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

export const handler: APIGatewayProxyHandlerV2 = async () => {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "ok" }),
  };
};
```

- [x] **Step 2: Type-check it in isolation**

Run: `cd app/api && yarn build`
Expected: `tsc` exits 0 (no `.ts` errors) — this will also compile `bin/` and `lib/` once they exist in Task 4, so re-run after Task 4 if this task is done first; at this point in the plan it's fine if `tsc` reports missing `bin/api.ts` / `lib/api-stack.ts` since they don't exist yet. Skip strict verification of this step's exit code until Task 4 is complete.

- [x] **Step 3: Commit**

```bash
cd app/api
git add lambda/health.ts
git commit -m "feat: add health check Lambda handler"
```

---

### Task 4: CDK stack and app entry point

**Files:**
- Create: `app/api/lib/api-stack.ts`
- Create: `app/api/bin/api.ts`

**Interfaces:**
- Consumes: `lambda/health.ts`'s `handler` export (Task 3) as the `NodejsFunction` entry point.
- Produces: `export class ApiStack extends Stack` (constructor signature `(scope: Construct, id: string, props?: StackProps)`) — used by `bin/api.ts` in this task and by Task 5's test file, which imports `ApiStack` from `../lib/api-stack` and instantiates it against a `new App()`.

- [x] **Step 1: Write lib/api-stack.ts**

```typescript
import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "api",
    });

    const healthFunction = new NodejsFunction(this, "HealthFunction", {
      entry: path.join(__dirname, "..", "lambda", "health.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
    });

    httpApi.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "HealthIntegration",
        healthFunction,
      ),
    });

    new (require("aws-cdk-lib").CfnOutput)(this, "HttpApiUrl", {
      value: httpApi.apiEndpoint,
    });
  }
}
```

Replace the `require("aws-cdk-lib").CfnOutput` line with a proper top-level import — write it as:

```typescript
import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
```

and then:

```typescript
new CfnOutput(this, "HttpApiUrl", { value: httpApi.apiEndpoint });
```

(The `require(...)` form above is a placeholder to avoid a second code block — use the clean top-level import in the actual file.)

- [x] **Step 2: Write bin/api.ts**

```typescript
#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";

const app = new App();

new ApiStack(app, "ApiStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
```

- [x] **Step 3: Verify the app synthesizes locally (no AWS calls)**

Run: `cd app/api && yarn cdk synth`
Expected: exits 0 and prints a CloudFormation template containing an `AWS::ApiGatewayV2::Api` resource and an `AWS::Lambda::Function` resource. This does not contact AWS — `cdk synth` is a local template-generation step, distinct from `cdk bootstrap`/`cdk deploy`.

- [x] **Step 4: Run the build**

Run: `cd app/api && yarn build`
Expected: `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
cd app/api
git add lib/api-stack.ts bin/api.ts
git commit -m "feat: add ApiStack with HTTP API and health route"
```

---

### Task 5: CDK assertions test for the health route

**Files:**
- Create: `app/api/test/api-stack.test.ts`
- Create: `app/api/jest.config.js`

**Interfaces:**
- Consumes: `ApiStack` from `../lib/api-stack` (Task 4).

- [x] **Step 1: Write jest.config.js**

```javascript
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
};
```

- [x] **Step 2: Write the failing test**

```typescript
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ApiStack } from "../lib/api-stack";

describe("ApiStack", () => {
  it("creates an HTTP API with a GET /health route backed by a Lambda", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /health",
    });
    template.resourceCountIs("AWS::Lambda::Function", 1);
  });
});
```

- [x] **Step 3: Run it to confirm it passes**

Run: `cd app/api && yarn test`
Expected: PASS — `ApiStack › creates an HTTP API with a GET /health route backed by a Lambda`.

(This test is written after the implementation in Task 4 rather than before, because the task decomposition in this plan separates "stack + entry point" from "test" for file-ownership clarity. If following strict TDD, an engineer executing this plan may reorder: write this test first with a stub `ApiStack`, watch it fail, then implement Task 4.)

- [x] **Step 4: Commit**

```bash
cd app/api
git add jest.config.js test/api-stack.test.ts
git commit -m "test: add CDK assertions test for health route"
```

---

### Task 6: Final verification pass

**Files:** none (verification only)

- [x] **Step 1: Full clean install**

Run: `cd app/api && yarn install --immutable`
Expected: exits 0.

- [x] **Step 2: Build**

Run: `cd app/api && yarn build`
Expected: exits 0.

- [x] **Step 3: Test**

Run: `cd app/api && yarn test`
Expected: all tests pass.

- [x] **Step 4: Synth (local only, no AWS calls)**

Run: `cd app/api && yarn cdk synth`
Expected: exits 0, template includes the `/health` route.

- [x] **Step 5: Confirm no deploy/bootstrap was run**

Confirm `yarn cdk bootstrap` and `yarn cdk deploy` were never invoked during this plan's execution — those remain manual, user-run steps per CLAUDE.md.
