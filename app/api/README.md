# api

## Database

- `cdk deploy` provisions the Aurora Serverless v2 cluster but does **not** apply any migrations.
- After deploying (or after schema changes), run `yarn db:migrate:remote` from `app/api/` to apply `db/migrations/*.sql` via the `api-migrate` Lambda (invoked over `aws lambda invoke`).
- Destroying the stack (`cdk destroy`) deletes the Aurora cluster with no final snapshot (`removalPolicy: DESTROY`). This is intentional for this hands-on/demo project to avoid snapshot storage costs, but it means data loss on destroy is permanent.
