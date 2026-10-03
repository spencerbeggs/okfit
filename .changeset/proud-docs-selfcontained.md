---
"@okfit/claude-code-plugin": patch
---

## Bug Fixes

- Correct the `docs-render` skill and `okf-publisher` agent: `okfit sync --publication` exits 64 for a bad id or an unresolvable `renders` source and 3 for a malformed `renders` list, the orphan check now runs before rendering, and both document the no-fact source edit and the uncommitted Publication edit.
- Make `docs-badges` and `docs-templates` self-contained: `docs-badges` reads its own `package.json` fields and `docs-templates` carries the single-package, monorepo-root and sub-package shape rule instead of depending on `docs-detect-shape` having run.
