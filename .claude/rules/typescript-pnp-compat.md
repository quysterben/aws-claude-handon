---
paths:
  - "app/api/**"
---

# TypeScript version must stay on the 5.x line

`app/api` uses Yarn Berry with `nodeLinker: pnp`. Yarn ships a builtin compatibility patch (`compat/typescript`) that makes ambient/global type resolution (`process`, `__dirname`, etc.) work under PnP without a physical `node_modules/@types` directory.

- Do not upgrade `typescript` to `latest`/7.x in `app/api` without verifying first. TypeScript 7.0.x restructured its dist layout (Go-based `tsc` rewrite) in a way that breaks Yarn's builtin patch (`ENOENT ... lib/_tsc.js` during `yarn add`/`yarn install`).
- Keep `typescript` pinned to a 5.x release (currently `5.9.3` in `app/api/package.json`) unless you've confirmed Yarn's compat patch — or an updated Yarn release — supports whatever version you're moving to.
- Do not add an explicit `typeRoots` override in `app/api/tsconfig.json` pointing at `./node_modules/@types` — that path doesn't exist under PnP and breaks the compat patch's ambient-type resolution. Leave `typeRoots` unset.
