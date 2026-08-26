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

2. **Pre-deploy checks (safe — local-only or read-only):**
   ```bash
   yarn build        # type-check
   yarn test         # CDK assertions + unit tests
   yarn cdk synth    # synthesizes the template, no AWS calls
   yarn cdk diff     # compares against the deployed stack, read-only
   ```

3. **Deploy the stack (billable, creates real AWS resources):**
   ```bash
   yarn cdk deploy
   ```
   Provisions the VPC (isolated subnets, no NAT), the Aurora Serverless v2 cluster (Data API enabled, `minCapacity: 0` auto-pause), the Secrets Manager VPC endpoint, `HealthFunction`, `MigrateFunction`, and the HTTP API. On success, CDK prints three outputs: `HttpApiUrl` (the API base URL), `DbClusterEndpoint` (informational), and `MigrateFunctionName` (`api-migrate`).

4. **Apply migrations (manual — never automatic):**
   ```bash
   yarn db:migrate:remote
   ```
   See the Database section below for why this is a separate step.

5. **Verify:**
   ```bash
   curl <HttpApiUrl>/health
   # expect {"status":"ok","db":"ok"} (or "unreachable" if the cluster is still resuming from pause — retry)
   ```

6. **Tear down when done:**
   ```bash
   yarn cdk destroy
   ```
   See the data-loss note in the Database section below before running this.

**Cost note:** `minCapacity: 0` lets the cluster auto-pause when idle (roughly $1-3/month at low usage), but the Secrets Manager VPC interface endpoint has a fixed cost (~$7/month) that accrues regardless of usage for as long as the stack exists.

## Database

- `cdk deploy` provisions the Aurora Serverless v2 cluster but does **not** apply any migrations.
- After deploying (or after schema changes), run `yarn db:migrate:remote` from `app/api/` to apply `db/migrations/*.sql` via the `api-migrate` Lambda (invoked over `aws lambda invoke`).
- Destroying the stack (`cdk destroy`) deletes the Aurora cluster with no final snapshot (`removalPolicy: DESTROY`). This is intentional for this hands-on/demo project to avoid snapshot storage costs, but it means data loss on destroy is permanent.
