---
paths:
  - "app/api/**"
---

# Verify before claiming `app/api` work is done

After any change under `app/api`, run these from `app/api/` and confirm they pass before reporting the work as complete:

```
yarn build        # tsc type-check
yarn test         # jest + CDK assertions
yarn cdk synth    # local template synthesis, no AWS calls — safe to run freely
```

`yarn cdk synth` does not contact AWS and is not a deploy — it's safe to run any time. Do not run `yarn cdk bootstrap` or `yarn cdk deploy`; those are manual, user-run, billable operations against a real AWS account.
