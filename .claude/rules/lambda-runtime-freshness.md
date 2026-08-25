---
paths:
  - "app/api/lib/**"
  - "app/api/bin/**"
---

# Check Lambda Node.js runtime deprecation before scaffolding

When adding or reviewing a `NodejsFunction`/`Function` in `app/api/lib/api-stack.ts` (or any new CDK stack), don't assume an older `Runtime.NODEJS_*_X` constant from memory or from existing example code is still current — AWS deprecates Lambda Node.js runtimes on a rolling schedule, and CDK synth will emit a `CloudFormation-Validate::W2531` warning once a runtime is deprecated.

- Before picking a runtime, check `aws-cdk-lib`'s `Runtime` enum for the newest available `NODEJS_*_X` constant, and prefer it over older ones already used elsewhere in the codebase if those are flagged deprecated.
- `nodejs20.x` was deprecated 2026-04-30 (creation disabled 2027-02-01) — this stack now uses `nodejs24.x`. Re-check this note's dates against current reality before trusting it long-term; runtime deprecation schedules move.
