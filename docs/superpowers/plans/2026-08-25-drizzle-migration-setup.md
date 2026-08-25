# Drizzle Migration Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Drizzle ORM + `drizzle-kit` to `app/api` so schema migrations can be generated and applied by hand against the local Postgres database (from the repo-root `docker-compose.yaml`). Dev tooling only — no Lambda handler or CDK stack changes.

**Architecture:** `drizzle-kit` reads `app/api/drizzle.config.ts` (dialect `postgresql`, schema at `db/schema.ts`, migration output at `db/migrations/`, connection URL from `DATABASE_URL`). A developer runs `docker compose up -d` at the repo root to start Postgres, then `yarn db:generate` / `yarn db:migrate` from `app/api/` to diff the schema into SQL migration files and apply them. `db/schema.ts` starts empty — this task proves the wiring works, not a real data model.

**Tech Stack:** `drizzle-orm`, `drizzle-kit`, `postgres` (postgres-js driver), `dotenv` — all installed via `yarn` (Yarn Berry, `node-modules` linker) in `app/api`.

**Spec:** `docs/superpowers/specs/2026-08-25-drizzle-migration-setup-design.md`

## Global Constraints

- Use `yarn`, not `npm`, for all dependency installs in `app/api`.
- Do not hand-write dependency version numbers in `package.json` — let `yarn add` populate them, per existing project convention (see `docs/superpowers/plans/2026-08-25-cdk-scaffold-health-check.md`).
- No Lambda handler or CDK stack (`lib/api-stack.ts`) changes — this task is migration tooling only.
- No auto-migration on deploy or cold start, no CDK custom resource/pipeline step.
- `db/schema.ts` must not define any real tables — scaffold only.
- `.env` must never be committed; `.env.example` documents the shape and is committed.
- Never run `git commit` without the user's explicit go-ahead for that specific commit, even though each task below ends with a "Commit" step — surface the change and wait for confirmation before running it.
- After the final task, `yarn build`, `yarn test`, and `yarn cdk synth` (existing CDK scaffold) must still all pass.

---

### Task 1: Add Drizzle dependencies and package.json scripts

**Files:**
- Modify: `app/api/package.json`
- Modify: `app/api/yarn.lock`

**Interfaces:**
- Produces: `drizzle-orm`, `postgres`, `drizzle-kit`, `dotenv` available as installed packages; `db:generate`, `db:migrate`, `db:studio` npm scripts that Task 2's `drizzle.config.ts` and Task 4's verification rely on.

- [ ] **Step 1: Install runtime dependencies**

Run from `app/api/`:

```bash
yarn add drizzle-orm postgres
```

- [ ] **Step 2: Install dev dependencies**

Run from `app/api/`:

```bash
yarn add -D drizzle-kit dotenv
```

- [ ] **Step 3: Add scripts to package.json**

Edit `app/api/package.json` so the `"scripts"` block reads:

```json
"scripts": {
  "build": "tsc",
  "test": "jest",
  "cdk": "cdk",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio"
}
```

Leave `dependencies` / `devDependencies` exactly as `yarn add` wrote them in Steps 1–2 — do not hand-edit version numbers.

- [ ] **Step 4: Verify install succeeded**

Run: `yarn install --immutable` (from `app/api/`)
Expected: exits 0, no resolution errors.

- [ ] **Step 5: Commit**

```bash
cd app/api
git add package.json yarn.lock
git commit -m "chore: add drizzle-orm, drizzle-kit, postgres, dotenv dependencies"
```

---

### Task 2: Create schema scaffold and drizzle-kit config

**Files:**
- Create: `app/api/db/schema.ts`
- Create: `app/api/drizzle.config.ts`

**Interfaces:**
- Consumes: `drizzle-kit`'s `defineConfig` (from Task 1's install).
- Produces: `./db/schema.ts` schema source and `./db/migrations` output path that Task 1's `db:generate`/`db:migrate` scripts read; `DATABASE_URL` env var contract that Task 3's `.env`/`.env.example` must satisfy.

- [ ] **Step 1: Write the empty schema scaffold**

Create `app/api/db/schema.ts`:

```ts
// Drizzle schema definitions go here.
//
// Example:
// import { pgTable, serial, text } from "drizzle-orm/pg-core";
//
// export const users = pgTable("users", {
//   id: serial("id").primaryKey(),
//   email: text("email").notNull(),
// });
```

- [ ] **Step 2: Write drizzle.config.ts**

Create `app/api/drizzle.config.ts`:

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy app/api/.env.example to app/api/.env and fill in your local Postgres connection string.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run from `app/api/`: `yarn build`
Expected: exits 0 (no type errors in `db/schema.ts` or `drizzle.config.ts`).

- [ ] **Step 4: Commit**

```bash
cd app/api
git add db/schema.ts drizzle.config.ts
git commit -m "feat: add drizzle-kit config and empty schema scaffold"
```

---

### Task 3: Add local env files and gitignore entry

**Files:**
- Create: `app/api/.env.example`
- Create: `app/api/.env`
- Modify: `app/api/.gitignore`

**Interfaces:**
- Consumes: `DATABASE_URL` contract defined by Task 2's `drizzle.config.ts`.
- Produces: local `DATABASE_URL` value that Task 4's `db:generate`/`db:migrate` verification connects with.

- [ ] **Step 1: Write .env.example**

Create `app/api/.env.example`:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/app
```

- [ ] **Step 2: Write .env with the real local value**

Create `app/api/.env` (same content as `.env.example` — matches the repo-root `docker-compose.yaml` Postgres credentials):

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/app
```

- [ ] **Step 3: Add .env to .gitignore**

Edit `app/api/.gitignore`, add a new line under the `node_modules` line:

```
node_modules

# Local environment overrides (never commit secrets)
.env
```

- [ ] **Step 4: Verify .env is ignored and .env.example is not**

Run from `app/api/`: `git status --short`
Expected: `.env` does not appear (ignored); `.env.example` and `.gitignore` appear as untracked/modified.

- [ ] **Step 5: Commit**

```bash
cd app/api
git add .env.example .gitignore
git commit -m "chore: add .env.example and ignore .env for local DB config"
```

(`.env` itself is never committed — it's excluded by `.gitignore`.)

---

### Task 4: Verify migration wiring end-to-end

**Files:** none created or modified — verification only (plus whatever `drizzle-kit generate` writes under `app/api/db/migrations/`, if anything).

**Interfaces:**
- Consumes: `docker-compose.yaml` (repo root), `app/api/drizzle.config.ts` and `db:generate`/`db:migrate` scripts from Tasks 1–3.

- [ ] **Step 1: Start local Postgres**

Run from the repo root: `docker compose up -d`
Expected: `db` container starts and is healthy (`docker compose ps` shows it `Up`).

- [ ] **Step 2: Run drizzle-kit generate against the empty schema**

Run from `app/api/`: `yarn db:generate`
Expected: exits 0. Since `db/schema.ts` defines no tables, it's expected to report nothing to generate (e.g. "No schema changes, nothing to migrate") rather than error.

- [ ] **Step 3: Run drizzle-kit migrate**

Run from `app/api/`: `yarn db:migrate`
Expected: exits 0, connects successfully, applies zero migrations (none exist yet).

- [ ] **Step 4: Confirm the existing CDK scaffold still works**

Run from `app/api/`:

```bash
yarn build
yarn test
yarn cdk synth
```

Expected: all three exit 0, matching pre-existing behavior (this task must not break the `GET /health` scaffold).

- [ ] **Step 5: Commit any generated migration artifacts**

If Step 2 created a `db/migrations/` directory (even if empty of `.sql` files, drizzle-kit may write a `meta/` folder), stage and commit it:

```bash
cd app/api
git add db/migrations
git status --short
```

If there is nothing to commit, skip this step — note in the task summary that no migration files were generated (expected, since the schema is empty).

```bash
git commit -m "chore: verify drizzle migration wiring against local Postgres"
```

(Only run this commit if Step 5's `git add` actually staged something.)
