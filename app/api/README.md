# api

## Deploying to AWS

Deploys are manual and user-run — none of these steps run automatically.

0. **Prerequisites (one-time):** AWS credentials configured (`aws configure` or `AWS_PROFILE`) with sufficient IAM permissions (CDK, RDS, VPC, Lambda, Secrets Manager, IAM). Then from `app/api/`:
   ```bash
   yarn install --immutable
   ```

1. **Bootstrap CDK (one-time per account/region):**
   ```bash
   yarn cdk bootstrap
   ```
   Skip if this account/region is already bootstrapped.

2. **Build the frontend (required before synth/deploy):**
   ```bash
   cd app/client && npm install && npm run build
   ```
   `ClientStack` packages `app/client/build/` as a CDK asset — synth and deploy fail if it doesn't exist yet. Any `REACT_APP_*` env vars (e.g. `REACT_APP_API_BASE_URL`) are baked into the JS bundle at this build step, so rebuild whenever they change.

3. **Pre-deploy checks (safe — local-only or read-only), from `app/api/`:**
   ```bash
   yarn build        # type-check
   yarn test         # CDK assertions + unit tests
   yarn cdk synth    # synthesizes both stacks' templates, no AWS calls
   yarn cdk diff     # compares against the deployed stacks, read-only
   ```

4. **Deploy both stacks (billable, creates real AWS resources):**
   ```bash
   yarn cdk deploy --all
   ```
   `ClientStack` deploys first (an S3 bucket, a CloudFront distribution using Origin Access Control, and a `BucketDeployment` that syncs `app/client/build/` and invalidates the CloudFront cache), since `ApiStack` depends on it. It prints `DistributionUrl` (the frontend's public URL) and `BucketName`.

   `ApiStack` then provisions the VPC (isolated subnets, no NAT), the Aurora Serverless v2 cluster (Data API enabled, `minCapacity: 0` auto-pause), the Secrets Manager VPC endpoint, the Cognito User Pool + App Client, `HealthFunction`, `RegisterFunction`, `LoginFunction`, `MigrateFunction`, and the HTTP API — whose CORS `allowOrigins` automatically includes `ClientStack`'s `DistributionUrl` via a cross-stack reference, so there's no manual CORS step. On success it prints `HttpApiUrl` (the API base URL), `DbClusterEndpoint` (informational), `MigrateFunctionName` (`api-migrate`), `UserPoolId`, and `UserPoolClientId`.

   **Warning:** do not call `POST /auth/register` yet. Until migrations are applied (step 5), the `users` table doesn't have the shape `RegisterFunction` expects, so a register call will create the Cognito user successfully and then fail the Postgres profile insert — leaving an orphaned Cognito user with no matching Postgres row. That orphaned user can still log in via `POST /auth/login` (which never touches Postgres), so the inconsistency won't be visible from login alone. Always apply migrations (step 5) before exercising the auth endpoints.

5. **Apply migrations (manual — never automatic):**
   ```bash
   yarn db:migrate:remote
   ```
   See the Database section below for why this is a separate step.

6. **Verify:**
   ```bash
   curl <HttpApiUrl>/health
   # expect {"status":"ok","db":"ok"} (or "unreachable" if the cluster is still resuming from pause — retry)

   curl -X POST <HttpApiUrl>/auth/register \
     -H 'content-type: application/json' \
     -d '{"email":"user@example.com","password":"Sup3r$ecret","name":"Ada Lovelace"}'
   # expect 201 with {"id":"<cognito-sub>","email":"user@example.com","name":"Ada Lovelace","role":"USER"}

   curl -X POST <HttpApiUrl>/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"user@example.com","password":"Sup3r$ecret"}'
   # expect 200 with {"idToken":"...","accessToken":"...","refreshToken":"...","expiresIn":...}
   ```
   Then open `<DistributionUrl>` in a browser and exercise the register → login → home flow end-to-end.

7. **Tear down when done:**
   ```bash
   yarn cdk destroy --all
   ```
   See the data-loss note in the Database section below before running this.

**Cost note:** `minCapacity: 0` lets the cluster auto-pause when idle (roughly $1-3/month at low usage), but the Secrets Manager VPC interface endpoint has a fixed cost (~$7/month) that accrues regardless of usage for as long as the stack exists. `ClientStack` (S3 + CloudFront) is separate and typically near $0/month at low traffic — S3 storage for a CRA build is negligible, and CloudFront's always-free tier covers 1TB transfer + 10M requests/month.

## Database

- `cdk deploy` provisions the Aurora Serverless v2 cluster but does **not** apply any migrations.
- After deploying (or after schema changes), run `yarn db:migrate:remote` from `app/api/` to apply `db/migrations/*.sql` via the `api-migrate` Lambda (invoked over `aws lambda invoke`).
- Destroying the stack (`cdk destroy`) deletes the Aurora cluster with no final snapshot (`removalPolicy: DESTROY`). This is intentional for this hands-on/demo project to avoid snapshot storage costs, but it means data loss on destroy is permanent.
