---
paths:
  - "app/api/**"
---

# TypeScript version must stay on the 5.x line

`app/api` uses Yarn Berry (`nodeLinker: node-modules`). Yarn still ships a builtin compatibility patch (`compat/typescript`) that it applies to the `typescript` package regardless of linker — this patch is present in `yarn.lock` as `typescript@patch:typescript@npm%3A5.9.3#optional!builtin<compat/typescript>`.

- Do not upgrade `typescript` to `latest`/7.x in `app/api` without verifying first. TypeScript 7.0.x restructured its dist layout (Go-based `tsc` rewrite) in a way that breaks Yarn's builtin patch (`ENOENT ... lib/_tsc.js` during `yarn add`/`yarn install`) — this reproduced even after switching off PnP to the `node-modules` linker, so it isn't a PnP-only issue.
- Keep `typescript` pinned to a 5.x release (currently `5.9.3` in `app/api/package.json`) unless you've confirmed Yarn's compat patch — or an updated Yarn release — supports whatever version you're moving to.
