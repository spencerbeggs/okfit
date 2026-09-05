---
"@okfit/profiles": minor
---

## Features

### `software-project` profile

Ships `Profiles.softwareProject`, a complete `OkfitConfig` value for a software repository's knowledge bundle: `Project`, `Module`, `Decision`, `Convention`, `Interface`, and `Reference` concept types with their required fields, enumerated `kind` vocabularies, and a five-tag vocabulary (`architecture`, `testing`, `release`, `security`, `performance`). `Profiles.get(name)` resolves a profile by name; `Profiles.softwareProject.check(bundle)` enforces that exactly one `Project` concept exists at the bundle root, reporting `project-missing`, `project-multiple`, or `project-not-at-root` as needed. `Profiles.softwareProject.layout` gives `okfit init` the directory-to-type scaffolding.

### Git-derived provenance

Adds `GitHistory`, a service that walks a path's commit history (`git log --follow --diff-merges=first-parent`) to answer `pathLog`, and `Derivation`, a facade over it and `@effected/git`'s `Git` service:

* `Derivation.generatedAt` reports whether a concept's body is `committed` (with the author date, sha, and committer identity of the commit that last changed it) or `uncommitted` (`untracked`, `dirty`, or `unborn`), without ever substituting the current time.
* `Derivation.generatedBy` resolves the writing actor for an explicit `"agent" | "human"` writer, matching `config.actors.humans` against the caller's git identity.
* `Derivation.staleAfter` computes a stale-by instant from `config.lifecycle.default_stale_after`, defaulting to 90 days.

Both doubles are available for tests without spawning git: `GitHistory.makeTest`/`GitHistory.layerTest` and `@effected/git`'s own `Git.layerTest`.

## Dependencies

`@okfit/profiles` now peers on `@effected/git` and `@effected/markdown` alongside `@okfit/core` and `effect` (the former `dependencies` block is gone); `@effect/platform-node`, `@effected/toml`, and `@effect/vitest` are dev-only test tooling.

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| @okfit/core | dependency | removed | workspace:* | — |
| @okfit/core | peerDependency | added | — | workspace:^ |
| @okfit/core | devDependency | added | — | workspace:* |
| effect | dependency | removed | catalog:effect | — |
| effect | peerDependency | added | — | catalog:effect:peers |
| effect | devDependency | added | — | catalog:effect |
| @effected/git | peerDependency | added | — | catalog:effected:peers |
| @effected/git | devDependency | added | — | catalog:effected |
| @effected/markdown | peerDependency | added | — | catalog:effected:peers |
| @effected/markdown | devDependency | added | — | catalog:effected |
| @effect/platform-node | devDependency | added | — | catalog:effect |
| @effect/vitest | devDependency | added | — | catalog:effect |
| @effected/toml | devDependency | added | — | catalog:effected |
