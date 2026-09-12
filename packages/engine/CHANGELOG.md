# @okfit/engine

## 0.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |
| @effected/app | dependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/config-file | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/git | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/glob | dependency | updated | ^0.5.0 | ^0.6.0 |
| @effected/jsonc | dependency | updated | ^0.9.0 | ^0.11.0 |
| @effected/markdown | dependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/store | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/toml | dependency | updated | ^0.6.0 | ^0.7.0 |
| @effected/walker | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/xdg | dependency | updated | ^0.4.1 | ^0.5.0 |
| @effected/yaml | dependency | updated | ^0.14.0 | ^0.15.0 |
| @okfit/core | dependency | updated | 0.3.0 | 0.3.1 |
| @okfit/profiles | dependency | updated | 0.3.0 | 0.3.1 |
| effect | dependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

[#55][#55]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#55]: https://github.com/spencerbeggs/okfit/pull/55

## 0.2.0

### Breaking Changes

- `validate/run.ts#run`'s requirements channel now includes
  `Crypto.Crypto`, alongside the existing `FileSystem.FileSystem |
  Path.Path | Git | GitHistory`. A caller providing `NodeServices.layer`
  or `OkfitPlatform` (as `@okfit/mcp`'s `validateBundle.ts` and the CLI's
  `commands/validate.ts` already do) needs no change; only a caller
  assembling a narrower custom layer for `run` directly must add
  `Crypto.Crypto` to it. [#49][#49]

### Features

- `okfit sync --only generated` (and full `okfit sync`) now leaves a
  concept's `generated.at` untouched when its recorded
  `generated.body_sha256` still matches the current body — this is what
  stops a restamp commit after every squash or rebase merge (issue #19).
  Any other case (no recorded digest, or a mismatched one) writes both
  `generated.at` and `generated.body_sha256` together.
- `okfit verify`'s locate/splice pass generalized to handle both
  `generated.at` and `generated.body_sha256`: when a concept needs both
  fields freshly stamped at the same insertion point, the two edits merge
  into one rather than producing the "overlapping edits" case
  `MarkdownEdit.applyAll` treats as a programmer error.
- `okfit validate --skip-provenance` now narrows to skip only the
  git-derived fallback tier of the `generated-at-drift` lint (the
  date comparison used for a concept with no recorded
  `generated.body_sha256`). The pure, in-memory digest comparison still
  runs and still reports drift for a migrated concept even with the flag
  set — this is what lets an edit-time `validate` stay git-free while
  still catching an edited-but-unstamped body. Previously the flag
  dropped the `generated-at-drift` lint entirely.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.2.0 | 0.3.0 |
| @okfit/profiles | dependency | updated | 0.2.0 | 0.3.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#49]: https://github.com/spencerbeggs/okfit/pull/49

## 0.1.0

### Features

- New package. `@okfit/engine` holds the platform layer (`OkfitPlatform`, `OKFIT_APP_NAMESPACE`), config discovery and resolution, the JSON envelope contracts, and the validate/verify/sync/init/context programs that used to live inside `@okfit/cli`.

- `@okfit/cli` and `@okfit/mcp` are both direct consumers, each importing `@okfit/engine` rather than duplicating this logic or copy-contracting through the CLI

- Enforces its own boundary test: no file under `engine/src` may read `process`

- Assembles the same `OkfitPlatform` layer for both front ends, so the CLI and the MCP server resolve the same user-level config directory structurally [#28][#28]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#28]: https://github.com/spencerbeggs/okfit/pull/28
