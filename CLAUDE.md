# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This directory (`aws-claude-handon/`) is a single git repository. `app/` contains two projects that share this repo but are otherwise independent codebases:

- `app/api/` — a Yarn Berry (`node-modules` linker) project. Backend architecture: AWS Lambda behind API Gateway, provisioned and deployed via AWS CDK (TypeScript). Scaffolded with a working `GET /health` route; see "Current state" below.
- `app/client/` — a Create React App project (React 19, `react-scripts` 5.0.1) with Login/Register/Home auth screens wired to `app/api`'s auth routes; see "Structure" below.

Treat these as separate projects for tooling purposes: run commands from inside the relevant subdirectory (`cd app/client` or `cd app/api`), not from the top level. Documentation (specs, implementation plans) lives at the repository root in `docs/`, not nested inside `app/api/` or `app/client/`, since it is one shared repo — see `docs/superpowers/plans/2026-08-25-cdk-scaffold-health-check.md` for the API scaffold's plan.

### Git workflow

Do not create commits or new branches on your own during development — propose the change and wait for explicit permission before committing or branching.

## `app/client/` — Create React App

### Commands
Run from within `app/client/`:

```
npm start          # dev server at http://localhost:3000, hot reload
npm test            # launches Jest in interactive watch mode
npm test -- --watchAll=false   # single non-interactive run
npm test -- <pattern>          # run tests matching a name/file pattern
npm run build        # production build to client/build
```

### Structure
`src/App.tsx` renders a `react-router-dom` `BrowserRouter`/`Routes` tree: `/login` and `/register` (each wrapped in `PublicOnlyRoute`), `/` (wrapped in `ProtectedRoute`, rendering `HomePage`), and a catch-all redirecting to `/`. `src/index.tsx` is the entry point (unchanged), rendering `<App />` with `ThemeProvider`/`CssBaseline` (`src/theme/theme.ts`).

- `src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `HomePage.tsx` — MUI-built screens. Register never auto-logs-in (backend returns no tokens from `/auth/register`); on success it redirects to `/login` with a success message in router state.
- `src/routes/ProtectedRoute.tsx` / `PublicOnlyRoute.tsx` — route guards reading `useIsAuthenticated()` from the auth store.
- `src/store/useAuthStore.ts` — zustand + `persist` (localStorage key `auth-storage`) holding `idToken`/`accessToken`/`refreshToken`; `useIsAuthenticated()` checks both token presence and the decoded `exp` claim; `useAuthUser()` decodes `idToken` (via `src/utils/jwt.ts`'s `decodeJwtPayload`) for display, since no user-profile endpoint exists. Note: its `persist` config currently uses `partialize` to persist only `idToken`, not `accessToken`/`refreshToken` — a known, intentionally-deferred deviation from the design doc (harmless today since nothing reads those two back from storage yet).
- `src/api/auth.ts` — `registerRequest`/`loginRequest`, thin wrappers over the existing `src/api/client.ts` axios instance (`baseURL` from `REACT_APP_API_BASE_URL`, set in a local `.env`, not committed). `src/api/errors.ts` extracts a display message from an axios error, falling back to a generic message when the response has none.
- `src/utils/passwordPolicy.ts` — client-side mirror of the backend's Cognito password policy, used for immediate `RegisterPage` feedback.
- `src/App.test.tsx` is deliberately left untouched (still asserts stale CRA content) — frontend test files are out of scope for this feature, per explicit user instruction; verification is `npm run build` only, never `npm test`.
- See `docs/superpowers/specs/2026-08-27-client-auth-screens-design.md` and `docs/superpowers/plans/2026-08-27-client-auth-screens.md` for the full design/plan. Manually verified end-to-end (register → login → home → logout, plus reload persistence) against the deployed `app/api` backend via chrome-devtools-mcp.

## `app/api/` — Lambda + API Gateway (AWS CDK)

Uses Yarn 4 with the standard `node-modules` linker (regular `node_modules/`, no PnP) — use `yarn`, not `npm`, for any dependency installs.

### Architecture
Serverless backend: **AWS Lambda** functions behind an **API Gateway HTTP API** (v2), provisioned with a TypeScript **AWS CDK** stack (`ApiStack`). Design docs live at `docs/superpowers/specs/` (`2026-08-25-drizzle-migration-setup-design.md` and `2026-08-25-aurora-serverless-lambda-connectivity-design.md`); this section is a summary, not a replacement for them:

- `ApiStack` (`lib/api-stack.ts`) is a thin orchestrator: it provisions the HTTP API and wires together a set of domain constructs under `lib/constructs/`, each owning its own Lambda(s) (`NodejsFunction`, esbuild-bundled automatically at synth/deploy — no separate build step), IAM grants, and route integrations (`HttpLambdaIntegration`). Adding a new API means adding a new construct file and wiring it into `ApiStack`, not growing the stack file itself.
  - The `HttpApi` construction in `api-stack.ts` also carries `corsPreflight` (allowed methods/headers, plus `allowOrigins`) since it's the only place the `HttpApi` itself is instantiated — CORS is not configured per-route in the domain constructs. `allowOrigins` currently only lists `http://localhost:3000` (local `app/client` dev); add any deployed client origin there before that environment can call the API.
  - `constructs/database.ts` — `DatabaseConstruct`: isolated-subnet VPC + Aurora Serverless v2 (PostgreSQL) cluster with RDS Data API enabled, exposes `vpc`/`cluster`/`secret`.
  - `constructs/auth.ts` — `AuthConstruct`: Cognito `UserPool` + `UserPoolClient`, exposes `userPool`/`userPoolClient`.
  - `constructs/health-api.ts` — `HealthApi`: `HealthFunction` + `GET /health` route. Connects to the database via Data API, not placed in the VPC.
  - `constructs/auth-api.ts` — `AuthApi`: `RegisterFunction` + `LoginFunction` + `POST /auth/register` / `POST /auth/login` routes. Also outside the VPC, Data API only.
  - `constructs/migrate.ts` — `MigrateConstruct`: `MigrateFunction`, the one Lambda that runs inside the VPC with a direct postgres-js connection to apply Drizzle migrations, invoked manually via `yarn db:migrate:remote` — never automatically on `cdk deploy`. Not wired to any HTTP route.
  - `constructs/shared.ts` — cross-construct helpers: `BaseApiConstructProps` (`lambdaDir` + `database`, extended by each domain construct's props) and shared `NodejsFunction` defaults (`LAMBDA_RUNTIME`, `DEFAULT_LAMBDA_TIMEOUT`).
- Lambda handlers live flat in `lambda/*.ts` (one file per route/entry point — `health.ts`, `auth-register.ts`, `auth-login.ts`, `migrate.ts` — each referenced by entry path from its construct); non-handler shared code (`jsonResponse`/`requireEnv`, Cognito secret-hash computation) lives in `lambda/helpers/` so it's not mistaken for a Lambda entry point.
- Layout: `bin/api.ts` (CDK entry), `lib/api-stack.ts` (stack orchestration), `lib/constructs/*.ts` (per-domain constructs + shared CDK helpers), `lambda/*.ts` (handlers), `lambda/helpers/*.ts` (shared non-handler code), `test/*.test.ts` (CDK assertions via `aws-cdk-lib/assertions`), `cdk.json`.
- `package.json` scripts: `build` (`tsc`), `test` (`jest`), `cdk` (`cdk`).
- Deploys are manual and user-run (`yarn cdk bootstrap`, then `yarn cdk deploy`) — the assistant should not run these against a real AWS account; they are billable and hard to reverse. `yarn cdk synth` is local-only (no AWS calls) and safe to run freely.

### Current state
Scaffolded and working: `ApiStack` (via its constructs, see above) provisions the HTTP API with three routes — `GET /health` (returns `{"status":"ok","db":"ok"|"unreachable"}`, the `db` field reflecting a live Data API check against Aurora), and `POST /auth/register` / `POST /auth/login`, backed by a Cognito User Pool. Registration is admin-driven (`AdminCreateUser` + `AdminSetUserPassword`, no self-service sign-up or email confirmation) and always creates a `"USER"`-role account; login uses `USER_PASSWORD_AUTH` and returns Cognito's tokens directly. The Postgres `users` table is repurposed as a Cognito-synced identity shadow table (`id` = Cognito `sub`, no password material), written once at registration and never read by login, so future business tables can FK to it. `yarn build`, `yarn test`, and `yarn cdk synth` all pass. See `docs/superpowers/plans/2026-08-25-cdk-scaffold-health-check.md` for how the initial scaffold was built, and `docs/superpowers/specs/2026-08-26-cognito-auth-register-login-design.md` / `docs/superpowers/plans/2026-08-26-cognito-auth-register-login.md` for the Cognito auth design and implementation plan.

On a freshly deployed stack, `/auth/register` will 500 with a Postgres `relation "users" does not exist` error until `yarn db:migrate:remote` has been run at least once — `cdk deploy` never runs migrations automatically (see `constructs/migrate.ts` above). Do this before testing register/login against a new deploy.

`.yarnrc.yml` pins `nodeLinker: node-modules` explicitly for reproducibility across machines, regardless of whatever a given machine's Yarn default happens to be.
