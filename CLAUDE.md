# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This directory (`aws-claude-handon/`) is a single git repository. `app/` contains two projects that share this repo but are otherwise independent codebases:

- `app/api/` — a Yarn Berry (`node-modules` linker) project. Backend architecture: AWS Lambda behind API Gateway, provisioned and deployed via AWS CDK (TypeScript). Scaffolded with a working `GET /health` route; see "Current state" below.
- `app/client/` — a standard, unmodified Create React App project (React 19, `react-scripts` 5.0.1).

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
Untouched CRA boilerplate: `src/App.js` is the root component, `src/index.js` is the entry point rendering `<App />` into `#root`. `src/App.test.js` / `src/setupTests.js` set up React Testing Library + Jest via `react-scripts test`. No routing, state management, or API integration has been added yet.

## `app/api/` — Lambda + API Gateway (AWS CDK)

Uses Yarn 4 with the standard `node-modules` linker (regular `node_modules/`, no PnP) — use `yarn`, not `npm`, for any dependency installs.

### Architecture
Serverless backend: **AWS Lambda** functions behind an **API Gateway HTTP API** (v2), provisioned with a TypeScript **AWS CDK** stack (`ApiStack`). Design docs live at `docs/superpowers/specs/` (`2026-08-25-drizzle-migration-setup-design.md` and `2026-08-25-aurora-serverless-lambda-connectivity-design.md`); this section is a summary, not a replacement for them:

- One CDK stack provisions the HTTP API, one Lambda per route (`NodejsFunction` from `aws-cdk-lib/aws-lambda-nodejs`, esbuild-bundled automatically at synth/deploy — no separate build step), and route integrations (`HttpLambdaIntegration`).
- `ApiStack` also provisions an isolated-subnet VPC and an Aurora Serverless v2 (PostgreSQL) cluster with RDS Data API enabled. The `HealthFunction` (and future API Lambdas) connect to the database via Data API and are not placed in the VPC at all. A separate `MigrateFunction` runs inside the VPC with a direct postgres-js connection to apply Drizzle migrations, and is invoked manually via `yarn db:migrate:remote` — never automatically on `cdk deploy`.
- Layout: `bin/api.ts` (CDK entry), `lib/api-stack.ts` (stack def), `lambda/*.ts` (handlers), `test/*.test.ts` (CDK assertions via `aws-cdk-lib/assertions`), `cdk.json`.
- `package.json` scripts: `build` (`tsc`), `test` (`jest`), `cdk` (`cdk`).
- Deploys are manual and user-run (`yarn cdk bootstrap`, then `yarn cdk deploy`) — the assistant should not run these against a real AWS account; they are billable and hard to reverse. `yarn cdk synth` is local-only (no AWS calls) and safe to run freely.

### Current state
Scaffolded and working: `ApiStack` provisions the HTTP API and a single `GET /health` Lambda route, which returns `{"status":"ok","db":"ok"|"unreachable"}` — the `db` field reflects a live Data API check against Aurora. `yarn build`, `yarn test`, and `yarn cdk synth` all pass. See `docs/superpowers/plans/2026-08-25-cdk-scaffold-health-check.md` for how the initial scaffold was built.

`.yarnrc.yml` pins `nodeLinker: node-modules` explicitly for reproducibility across machines, regardless of whatever a given machine's Yarn default happens to be.
