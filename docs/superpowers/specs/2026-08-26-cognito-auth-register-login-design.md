# Cognito Auth: Register + Login — Design

**Status:** Approved by user, ready for implementation planning.

## Goal

Add user authentication to `app/api` backed by **Amazon Cognito** as the identity/credential store, exposed through two new HTTP API routes — `POST /auth/register` and `POST /auth/login` — each backed by its own Lambda, following the existing one-Lambda-per-route pattern (`lib/api-stack.ts`, `lambda/health.ts`). This replaces the placeholder self-rolled auth implied by the current `db/schema.ts` `users` table (which has a `passwordHash` column but no code that uses it).

## Context

- `app/api` currently has `GET /health` (Data API-backed) and a manual-invoke `MigrateFunction`, provisioned by `ApiStack` (`lib/api-stack.ts`). See `docs/superpowers/specs/2026-08-25-aurora-serverless-lambda-connectivity-design.md` for the Aurora/Data API split (API Lambdas outside the VPC via Data API, migration Lambda inside the VPC via postgres-js) — this design builds on that split and does not change it.
- `db/schema.ts` currently defines a `users` table with `id serial`, `email`, `passwordHash`, `name`, `role` (`user_role` enum: `ADMIN`/`USER`), `createdAt`, `updatedAt`. Nothing in the codebase writes or reads this table yet.
- `db/client.ts` exports `getDb()` (Data API Drizzle client) and `withResumeRetry()`; both are reused as-is by the new register Lambda.

## Decisions

- **Cognito User Pool is the source of truth for credentials.** Password storage/verification is entirely Cognito's responsibility. `passwordHash` is removed from Postgres — there is no password material in Aurora at all.
- **Postgres `users` table is kept, but repurposed as an identity *shadow/reference* table**, not a credential store: `id` becomes the Cognito `sub` (`text`, not `serial`), `passwordHash` and `updatedAt` are dropped. This exists so that future business tables (e.g. a `posts` table) can have a normal Postgres foreign key (`posts.user_id → users.id`) and be queried/joined with SQL, instead of every read needing a Cognito `AdminGetUser` call. This was a deliberate reversal of an earlier "drop `users` entirely" option once the need for FK-able business tables came up.
- **Registration is admin-driven, not self-service Cognito `SignUp`.** The User Pool has `selfSignUpEnabled: false`. `POST /auth/register`'s Lambda uses `AdminCreateUserCommand` (suppressing Cognito's invite email) followed by `AdminSetUserPasswordCommand({ Permanent: true })` to set the caller-supplied password and move the user straight to `CONFIRMED` status — no email-verification-code step. Chosen for simplicity at this project's hands-on scale; standard `SignUp` + confirmation-code flow is explicitly out of scope.
- **Login uses `USER_PASSWORD_AUTH`** via `InitiateAuthCommand` (not `AdminInitiateAuth`), returning Cognito's `idToken`/`accessToken`/`refreshToken`/`expiresIn` directly to the caller. Chosen over SRP because it needs no client-side crypto beyond computing `SECRET_HASH`, and the caller is a Lambda (server-side), not a browser.
- **App Client has a generated secret** (`generateSecret: true`). Because both `AdminCreateUser`-family calls and `InitiateAuth` originate from our own Lambdas (never from a browser), a confidential client is appropriate. `InitiateAuth` with a secret-enabled client requires a `SECRET_HASH` (`HMAC-SHA256(username + clientId, clientSecret)`, base64-encoded) in `AuthParameters`; `AdminCreateUser`/`AdminSetUserPassword` do not need it (they're IAM-authorized admin APIs, not client-secret-authorized).
- **Client secret delivery: plain Lambda environment variable**, read from `userPoolClient.userPoolClientSecret` (CDK resolves this via a `DescribeUserPoolClient` custom resource at deploy time) and passed directly into `LoginFunction`'s `environment`. This differs from how the Aurora DB secret is handled (Secrets Manager + `grantRead`) — the trade-off is explicit here: the value ends up in the Lambda's plaintext configuration (visible via `GetFunctionConfiguration` to anyone with that IAM permission, and in the CloudFormation template). Accepted for this project's scale; moving it to Secrets Manager is a future hardening step, not done now.
- **Register writes to both systems: Cognito first, then Postgres.** `RegisterFunction` calls Cognito (`AdminCreateUser` + `AdminSetUserPassword`), reads the resulting `sub` from the `AdminCreateUser` response's `User.Attributes`, then inserts a row into Postgres `users` (`id`, `email`, `name`, `role`) via the existing Data API `getDb()` client. If the Postgres insert fails after Cognito succeeded, the error is surfaced to the caller as a 500 and logged — no compensating transaction/rollback of the Cognito user. Acceptable at this project's scale; not a system users depend on for correctness guarantees yet.
- **`LoginFunction` never touches Postgres.** Login only needs to authenticate against Cognito and return tokens; the JWT itself carries `sub` and any custom claims a future protected route would need, so there's no reason to query the `users` shadow table on every login.
- **Register API fields:** `{ email, password, name }` — no `role` field is accepted from the client. `role` is always hardcoded server-side to `"USER"`; any `role` present in the request body is silently ignored. This was a deliberate hardening after an earlier draft accepted a client-supplied `role`, which would have let any caller self-register as `"ADMIN"`. Provisioning an `ADMIN` account is out of scope for this design (see Out of scope). `name` is required (existing schema has it `NOT NULL`).

## Components

### CDK (`lib/api-stack.ts`)

- `cognito.UserPool` (new): `selfSignUpEnabled: false`, standard attribute `name` (mutable, not required-at-Cognito-level since we always supply it ourselves), custom attribute `role` (`cognito.StringAttribute`, mutable), `removalPolicy: RemovalPolicy.DESTROY` (matches the Aurora cluster's policy — this is a hands-on/dev stack, not production).
- `userPool.addClient("UserPoolClient", ...)`: `generateSecret: true`, `authFlows: { userPassword: true }`.
- `RegisterFunction` (`NodejsFunction`, `lambda/auth-register.ts`): outside the VPC (same as `HealthFunction`). IAM: `cognito-idp:AdminCreateUser` + `cognito-idp:AdminSetUserPassword` scoped to the User Pool ARN (`userPool.grant(registerFunction, "cognito-idp:AdminCreateUser", "cognito-idp:AdminSetUserPassword")` or equivalent explicit policy), plus `dbCluster.grantDataApiAccess(registerFunction)` (same grant `HealthFunction` already has). Env: `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `DB_RESOURCE_ARN`, `DB_SECRET_ARN`, `DB_NAME`.
- `LoginFunction` (`NodejsFunction`, `lambda/auth-login.ts`): outside the VPC, no Cognito IAM grant needed (`InitiateAuth` with `USER_PASSWORD_AUTH` + `SECRET_HASH` is not IAM-authorized), no Data API grant (doesn't touch Postgres). Env: `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET` (from `userPoolClient.userPoolClientSecret.unsafeUnwrap()` or equivalent).
- Routes added to the existing `httpApi.addRoutes(...)` calls: `POST /auth/register` → `RegisterFunction`, `POST /auth/login` → `LoginFunction`.
- `CfnOutput`s: `UserPoolId`, `UserPoolClientId` (informational, for manual testing). No output for the client secret.

### `lambda/auth-register.ts` (new)

- Parses/validates the JSON body: `email` and `password` required (400 if missing), `name` required (400 if missing). `role` is not read from the request body at all — it's hardcoded to `"USER"` in the handler, so any client-supplied `role` is silently ignored rather than validated.
- `AdminCreateUserCommand({ UserPoolId, Username: email, UserAttributes: [email, email_verified=true, name, custom:role], MessageAction: "SUPPRESS", TemporaryPassword: <random> })`.
- `AdminSetUserPasswordCommand({ UserPoolId, Username: email, Password: <caller's password>, Permanent: true })` — finalizes the account into `CONFIRMED`, usable by `POST /auth/login` immediately.
- Reads `sub` from the `AdminCreateUserCommand` response's `User.Attributes`, inserts `{ id: sub, email, name, role }` into Postgres `users` via `getDb()` + `withResumeRetry()` (both from `db/client.ts`, reused as-is).
- Errors: `UsernameExistsException` → 409; missing/invalid fields → 400; any other Cognito or Data API failure → 500 (logged).
- Success response: `201` with `{ id: sub, email, name, role }` (no tokens — login is a separate call).

### `lambda/auth-login.ts` (new)

- Parses/validates the JSON body: `email` and `password` required (400 if missing).
- Computes `SECRET_HASH` via a small pure helper (see below).
- `InitiateAuthCommand({ AuthFlow: "USER_PASSWORD_AUTH", ClientId, AuthParameters: { USERNAME: email, PASSWORD: password, SECRET_HASH } })`.
- Errors: `NotAuthorizedException` / `UserNotFoundException` → 401 with a generic "invalid credentials" message (does not distinguish the two, to avoid leaking whether an email is registered); missing fields → 400; any other failure → 500.
- Success response: `200` with `{ idToken, accessToken, refreshToken, expiresIn }` read from `AuthenticationResult`.

### `lambda/cognito-secret-hash.ts` (new, shared)

- Exports `computeSecretHash(username: string, clientId: string, clientSecret: string): string` — `HMAC-SHA256(username + clientId, clientSecret)`, base64-encoded, via Node's built-in `crypto` module. Pure function, no AWS SDK calls, unit-testable in isolation (mirrors how `db/client.ts`'s `withResumeRetry`/`isDatabaseResumingError` are pure and tested independently of a live DB).

### `db/schema.ts` (modified)

- `users.id` changes from `serial("id").primaryKey()` to `text("id").primaryKey()` (holds the Cognito `sub`).
- `passwordHash` column removed.
- `updatedAt` column removed (Cognito owns identity updates; Postgres is a synced read copy written once at registration).
- `userRoleEnum`, `email`, `name`, `role`, `createdAt` unchanged.
- Run `yarn db:generate` (no live DB connection needed) to produce the corresponding migration SQL under `db/migrations/`.

### Package changes (`app/api/package.json`)

- Add `@aws-sdk/client-cognito-identity-provider` as a dependency.

## Data flow

1. **Register:** client `POST /auth/register` with `{ email, password, name }` (any `role` field is ignored) → `RegisterFunction` creates the user in Cognito (admin-created, password set as permanent, `CONFIRMED` status, role hardcoded to `"USER"`) → reads `sub` from the Cognito response → inserts the shadow row into Postgres `users` via Data API → returns `201` with the created profile (no tokens).
2. **Login:** client `POST /auth/login` with `{ email, password }` → `LoginFunction` computes `SECRET_HASH` → calls Cognito `InitiateAuth` (`USER_PASSWORD_AUTH`) → returns Cognito's tokens directly to the client. No Postgres access on this path.
3. **Future protected routes** (out of scope here): would validate the `accessToken`/`idToken` (e.g. via an HTTP API JWT Authorizer against the User Pool) and can read `sub`/`custom:role` straight from token claims, optionally joining against the Postgres `users` shadow table (or business tables FK'd to it, e.g. a future `posts.user_id → users.id`) for anything beyond what's in the token.

## Error handling

- **Register — Cognito succeeds, Postgres insert fails:** surfaced as a `500` to the caller; logged with the created `sub` so it's discoverable/fixable manually. No automatic compensation (deleting the Cognito user) — accepted trade-off at this project's scale, per Decisions above.
- **Register — duplicate email:** Cognito's `UsernameExistsException` → `409`, no Postgres write attempted.
- **Login — wrong password / unknown user:** both map to a generic `401` (no information disclosure about account existence).
- **Validation errors** (missing/invalid fields in either endpoint): `400` before any AWS call is made.
- **Aurora paused (Data API `DatabaseResumingException`) during register's Postgres insert:** handled by the existing `withResumeRetry()` wrapper from `db/client.ts` — same tolerance `HealthFunction` already has.

## Testing / verification

Per `.claude/rules/api-verification.md`, run from `app/api/`:

- `yarn build`, `yarn test`, `yarn cdk synth` — must all pass.
- CDK assertion additions to `test/api-stack.test.ts`: `UserPool` resource present with `selfSignUpEnabled: false` and the `role` custom attribute; `UserPoolClient` present with a generated secret and `USER_PASSWORD_AUTH` enabled; `RegisterFunction` has the Cognito admin IAM grant + the same Data API grant shape as `HealthFunction` (and no VPC config); `LoginFunction` has no Cognito IAM grant and no Data API grant (and no VPC config); both new routes (`POST /auth/register`, `POST /auth/login`) wired to their respective Lambdas.
- Unit test for `computeSecretHash` (`lambda/cognito-secret-hash.ts`) — pure function, no mocking needed, similar in spirit to the existing `db-client.test.ts` coverage of `withResumeRetry`.
- **Not** run by the assistant: `yarn cdk deploy`, or any call against a real Cognito User Pool / Aurora cluster — manual, user-run, billable, consistent with existing repo rules.

## Out of scope

- Self-service Cognito `SignUp` + email confirmation-code flow (rejected in favor of admin-created, auto-confirmed users — see Decisions).
- Forgot-password / change-password / MFA flows.
- A JWT Authorizer on the HTTP API, or any protected route consuming the tokens `POST /auth/login` returns — this design only produces the tokens; wiring a route to require them is future work.
- A `refresh`-token endpoint (the client receives a refresh token from login but there's no endpoint to exchange it yet).
- Moving the Cognito client secret from a plain Lambda env var to Secrets Manager (noted as a trade-off in Decisions, not addressed now).
- Any new business table (e.g. `posts`) — this design only prepares `users` to be a valid FK target for such tables later; no such table is created here.
- Compensating/rollback logic for a Cognito-succeeds-but-Postgres-fails register (logged and left for manual fixup, per Decisions).
- Provisioning `ADMIN`-role accounts. `POST /auth/register` always hardcodes `role` to `"USER"` and ignores any `role` in the request body; creating an admin account requires a manual/out-of-band Cognito action, not implemented here.
