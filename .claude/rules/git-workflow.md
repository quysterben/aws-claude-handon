# Git workflow

This repository (`aws-claude-handon/`) is a single shared git repo at its root. `app/api/` and `app/client/` are subdirectories within it, not separate repos.

- Never create commits or new branches on your own during development — propose the change and wait for explicit permission before committing or branching.
- Never run `git init`, remove a `.git` directory, or otherwise change the repo's structure (e.g. turning a subdirectory into its own nested repo) without explicit permission. This repo previously had a nested `.git` mistakenly created inside `app/api/`, which had to be undone — don't repeat that mistake.
- Never run destructive git operations (`reset --hard`, `push --force`, `clean -f`, `branch -D`) without explicit permission.
