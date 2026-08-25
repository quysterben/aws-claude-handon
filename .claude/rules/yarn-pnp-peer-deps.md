---
paths:
  - "app/api/**"
---

# Unresolved peer dependencies under Yarn PnP

`app/api` uses strict Yarn PnP (`nodeLinker: pnp`), which enforces peer dependencies more strictly than the `node-modules` linker: a peer package that resolves ambiguously (present in the global cache but not declared as a direct dependency of this workspace) fails at runtime, e.g.:

```
Error: ts-jest tried to access jest-util (a peer dependency) but it isn't provided by your application
```

When you hit this:

- Add the peer package as an explicit `devDependency` (`yarn add -D <peer-package>`) rather than switching `nodeLinker` away from `pnp` or downgrading the package that requests it. (Example: `ts-jest@29.4.12` peer-depends on `jest-util`, which had to be added directly even though `jest@30` already depends on it transitively.)
- Check the failing package's actual `peerDependencies` range (`npm view <package>@<version> peerDependencies`) before assuming a version mismatch — the range may already support what's installed; the missing piece is usually just the explicit dependency declaration, not a version bump.
