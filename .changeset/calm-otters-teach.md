---
"@okfit/profiles": minor
---

## Features

The `software-project` profile grows its vocabulary:

* Five new types, each with its own layout directory: `Runbook` (a repeatable operational procedure), `Glossary` (a repo-specific term), `Limitation` (a known edge of a contract), `DataModel` (an internal source-of-truth structure), and `Gotcha` (a state or result that looks like one thing and is the opposite).
* Three new tags: `dx`, `ci`, `compat`.
* `Module.kind` gains `harness` (a private test-only package never published) and `config-dependency` (a package consumed through pnpm `configDependencies`).
* `Interface.kind` gains `runtime` (a runtime binding or platform capability rather than a shape).
* `Module` gains two optional fields: `layer` (the module's position in the repository's dependency-layering scheme) and `pins` (paths to sibling modules it is exact-version-pinned alongside).
