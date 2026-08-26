# Aurora Serverless v2 + Drizzle Lambda Connectivity — Design

**Status:** Approved by user, ready for implementation planning.

## Goal

Give `app/api` Lambdas a real runtime database: provision an Aurora Serverless v2 (PostgreSQL) cluster via CDK, connect the existing API Lambda(s) to it through Drizzle, and provide a way to apply the already-existing Drizzle migrations (`db/migrations/`, `db/schema.ts`) against that cluster. This is the runtime/infra half explicitly deferred as out of scope by `docs/superpowers/specs/2026-08-25-drizzle-migration-setup-design.md` (which only wired local-Postgres dev tooling).

## Context

- `app/api` already has Drizzle set up for local dev only: `drizzle-orm`, `drizzle-kit`, `postgres` (postgres-js) as dependencies, `db/schema.ts` with a `users` table, `db/migrations/` with generated SQL, and a root `docker-compose.yaml` running local Postgres 16. `drizzle.config.ts` currently requires `DATABASE_URL`.
- `app/api` currently has one route: `GET /health` (`lambda/health.ts`), provisioned by `lib/api-stack.ts` (`ApiStack`: `HttpApi` + one `NodejsFunction` per route, no VPC, no database).
- This design replaces the local-Postgres dev flow with a real Aurora Serverless v2 cluster; there is no longer a local database to develop against.

## Decisions

- **Aurora Serverless v2, PostgreSQL**, engine version 16.x (a version supporting 0-ACU scaling — verify the exact minor version supports it at implementation time; AWS requires Aurora PostgreSQL 13.15+/14.12+/15.7+/16.3+ for 0-ACU auto-pause).
- **`minCapacity: 0`, small `maxCapacity`** (e.g. `1`) — enables auto-pause when idle, matching this project's hands-on/low-traffic usage. Trade-off: the first request after an idle pause can throw `DatabaseResumingException` (Data API) or hang while the connection resumes (~15s); both connection paths need to tolerate this (timeout + single retry).
- **`enableDataApi: true`** on the cluster.
- **Two different connection paths for two different Lambda roles** — this is the central architectural decision:
  - **API Lambdas** (e.g. `health`, and future business routes) stay **outside the VPC** and connect via the **RDS Data API** (`drizzle-orm/aws-data-api/pg`, `@aws-sdk/client-rds-data`). No VPC attachment, no connection pooling concerns, no NAT.
  - **Migration Lambda** (new, `lambda/migrate.ts`) runs **inside the Aurora cluster's VPC** and connects via **postgres-js** directly (TCP), running `drizzle-orm/postgres-js/migrator` against the bundled `db/migrations/*.sql`. Chosen over a Data API migrator because it reuses the already-proven `drizzle-orm/postgres-js` migration path from the local-dev setup, rather than depending on Data API's newer/less-exercised migrator.
- **Migration Lambda credential retrieval:** a **VPC Interface Endpoint for Secrets Manager** is added to the VPC so the isolated-subnet migration Lambda can call `secretsmanager:GetSecretValue` without a NAT Gateway. Chosen over IAM DB Authentication (which would avoid the endpoint's fixed cost) because it reuses the existing Secrets-Manager-generated cluster credential directly, with no separate IAM-auth DB user bootstrap step.
- **Migration trigger: manual only.** No CDK Custom Resource / auto-invoke on `cdk deploy`. A new `app/api` script (e.g. `yarn db:migrate:remote`) wraps `aws lambda invoke` against the migration Lambda's function name (fixed via the `functionName` prop, so the script doesn't need to look it up). The developer runs it explicitly whenever they want migrations applied to the deployed cluster.
- **Local Postgres dev flow is removed**, not kept alongside Data API. There is only one deployed database (Aurora) going forward; nothing runs against a local Postgres instance.

## Components

### CDK (`lib/api-stack.ts`)

- New VPC (isolated subnets only — no NAT Gateway, no public subnets; nothing in this design needs outbound internet).
- New VPC Interface Endpoint for Secrets Manager in that VPC (used only by the migration Lambda).
- New `DatabaseCluster` (Aurora Serverless v2 Postgres): `enableDataApi: true`, `serverlessV2MinCapacity: 0`, `serverlessV2MaxCapacity: 1`, `credentials: Credentials.fromGeneratedSecret(...)`, deployed into the new VPC's isolated subnets.
- Existing `HealthFunction` (`NodejsFunction`) gains: `rds-data:ExecuteStatement` / `rds-data:BatchExecuteStatement` IAM grant scoped to the cluster ARN, `secretsmanager:GetSecretValue` grant on the cluster's secret, and environment variables for the cluster's resource ARN / secret ARN / database name. It stays outside the VPC (no `vpc`/`vpcSubnets` props).
- New `MigrateFunction` (`NodejsFunction`, `lambda/migrate.ts`): `functionName` set to a fixed value, deployed inside the Aurora VPC's isolated subnets, security group allowing egress to the Aurora cluster's security group on port 5432 (and to the Secrets Manager endpoint), `secretsmanager:GetSecretValue` grant on the cluster's secret, environment variables for the cluster's writer endpoint / secret ARN / database name. Bundling: esbuild `commandHooks` to copy `db/migrations/` into the bundle output (esbuild does not include non-JS assets automatically).
- `CfnOutput`s: cluster endpoint (informational), migration function name (matches the fixed `functionName`, documents what the invoke script targets).

### `db/client.ts` (new, shared)

- Exports a `getDb()` used by API Lambda handlers: builds `drizzle-orm/aws-data-api/pg`'s `drizzle()` from an `RDSDataClient`, the cluster's `resourceArn`, `secretArn`, and `database` name (read from env vars set by CDK). Initialized once at module scope so it's reused across warm invocations.
- Wraps calls with a single retry on `DatabaseResumingException` (wait ~15s, retry once) to tolerate the cluster resuming from an auto-pause.

### `lambda/health.ts` (modified)

- After the existing `{"status":"ok"}` response logic, run a lightweight query (`SELECT 1`) through `db/client.ts`'s `getDb()` and include DB reachability in the response — proves the Data API connection path works end-to-end.

### `lambda/migrate.ts` (new)

- On invoke: builds a `postgres-js` client from connection details fetched from Secrets Manager (host/port/user/password/dbname — host is the cluster's writer endpoint, passed via env var; credentials fetched from the secret at runtime), then runs `drizzle-orm/postgres-js/migrator`'s `migrate()` pointed at the bundled `db/migrations` folder.
- Sets a generous connect timeout to tolerate the cluster resuming from pause; on a connection-phase failure, one retry after a short delay is acceptable (mirrors the API-side tolerance for the same underlying cause).
- Returns a summary of what was applied (or that there was nothing to apply) as the Lambda response, so `aws lambda invoke`'s output file shows the result directly.

### Package changes (`app/api/package.json`)

- Keep `drizzle-orm`, `postgres`, `drizzle-kit` (all still used — `postgres` by the migration Lambda, `drizzle-kit` for `db:generate`).
- Add `@aws-sdk/client-rds-data` (Data API client) and `@aws-sdk/client-secrets-manager` (migration Lambda's runtime credential fetch) as dependencies.
- Scripts: keep `db:generate`; remove `db:migrate` (drizzle-kit CLI against `DATABASE_URL`, no longer meaningful — there's no reachable `DATABASE_URL` from a dev machine); add `db:migrate:remote` (`aws lambda invoke` wrapper against the fixed migration function name).

### Cleanup

- Delete root `docker-compose.yaml`.
- Simplify `drizzle.config.ts`: drop the `DATABASE_URL` requirement and `dbCredentials` block — `drizzle-kit generate` only needs `dialect`/`schema`/`out`, not a live connection.
- Remove `DATABASE_URL` from `.env.example` (and `.env`, which is gitignored).

## Data flow

1. **Schema change:** developer edits `db/schema.ts`, runs `yarn db:generate` locally (no DB connection needed) to produce a new SQL file under `db/migrations/`.
2. **Deploy infra:** developer runs `yarn cdk deploy` (manual, user-run, billable — not run by the assistant) to provision/update the Aurora cluster, VPC, endpoint, and both Lambdas. This does **not** apply migrations.
3. **Apply migrations:** developer runs `yarn db:migrate:remote`, which invokes `MigrateFunction`; that Lambda connects via VPC + postgres-js and applies any pending SQL migrations to the live cluster.
4. **Serve traffic:** API Lambdas (e.g. `health`) handle requests, connecting to the same cluster via Data API — no VPC involved on this path.

## Error handling

- **Cluster paused (auto-resume in progress):** both connection paths must tolerate the ~15s resume window — Data API surfaces `DatabaseResumingException` (catch, wait, retry once); postgres-js's TCP connect should use an extended connect timeout and one retry on initial-connection failure.
- **Migration failure:** `lambda/migrate.ts` lets the error surface in the Lambda's response/logs; `aws lambda invoke`'s exit behavior and output file make failures visible to the developer running the script. No automatic rollback beyond what the migration SQL itself does.
- **Health check DB failure:** `/health` should still return a response distinguishing "API up, DB unreachable" from "all healthy" rather than throwing an unhandled 500 — exact response shape is an implementation detail, not fixed by this spec.

## Testing / verification

Per `app/api`'s standard verification (`.claude/rules/api-verification.md`), run from `app/api/`:

- `yarn build` — must pass.
- `yarn test` — existing CDK assertion tests must still pass; new/updated assertions should cover: VPC + Aurora cluster + Data API enabled, the Secrets Manager endpoint, `HealthFunction`'s IAM grants and lack of VPC config, `MigrateFunction`'s VPC placement/security group/IAM grants.
- `yarn cdk synth` — must pass (local only, no AWS calls, safe to run freely).
- **Not** run by the assistant: `yarn cdk deploy`, `yarn db:migrate:remote` against a real cluster, or anything else that touches a real AWS account — these are manual, user-run, billable steps, consistent with existing repo rules.

## Cost

At `minCapacity: 0`, light/intermittent usage: Aurora compute ~$1-3/month (auto-pause), Secrets Manager ~$0.40/month, Data API/Lambda/API Gateway within free tier for this scale. The one fixed cost regardless of usage is the **Secrets Manager VPC Interface Endpoint, ~$7/month**, since it runs as long as the stack exists. Total estimate: **roughly $8-11/month** while the stack is deployed, dominated by the endpoint rather than the database itself. Destroying the stack (`cdk destroy`, user-run) when not actively in use removes all of this.

## Out of scope

- Running `cdk deploy` or `cdk destroy` against a real AWS account (manual, user-run).
- Any new business/CRUD routes beyond extending `/health` to prove DB connectivity.
- Automatic migration-on-deploy (explicitly rejected in favor of the manual `db:migrate:remote` trigger).
- IAM Database Authentication (considered and rejected in favor of Secrets Manager + VPC endpoint, for simplicity).
- Connection pooling infrastructure (e.g. RDS Proxy) — not needed since API Lambdas use Data API (no persistent connections) and the migration Lambda's direct connections are low-frequency/manual.
- Rotation policy for the Aurora-generated Secrets Manager secret.
