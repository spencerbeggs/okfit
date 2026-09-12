# @okfit/core

## 0.3.1

### Documentation

- `Schema.toJsonSchemaDocument(okfitConfigDocumentFields)` now leaves declared tables open unless you pass `{ onExcessProperty: "error" }` — Effect's default flipped in rc.113. Pass the option to get the closed-table document the config schema contract describes. [#55][#55]

### Refactoring

- `lifecycle.default_stale_after` decodes through `SchemaGetter.transformEffect` (renamed upstream from `transformOrFail` in rc.113); no behaviour change.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/glob | peerDependency | updated | ^0.5.0 | ^0.6.0 |
| @effected/jsonc | peerDependency | updated | ^0.9.0 | ^0.11.0 |
| @effected/markdown | peerDependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/toml | peerDependency | updated | ^0.6.0 | ^0.7.0 |
| @effected/walker | peerDependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/yaml | peerDependency | updated | ^0.14.0 | ^0.15.0 |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

- Moves to `effect@4.0.0-rc.115`; the `effect` peer range and the `@effected/*` peer ranges advance with it.

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#55]: https://github.com/spencerbeggs/okfit/pull/55

## 0.3.0

### Features

- `Generated` gained an optional `body_sha256` key, validated by a new
  `BodySha256` schema (a lowercase 64-character hex sha256). Core only
  holds the field — it never computes a digest itself, since hashing needs
  a capability core's no-Node-imports rule keeps out of this package.
  `@okfit/profiles`' `Derivation.bodyDigest` is what computes it, and
  `okfit sync` is what writes it.

### Bug Fixes

- `lint.generated_at_drift`'s default severity moved from `info` to `warn`
  (issue #19). A `generated.at` that no longer matches its last
  body-changing commit is a real signal once a bundle records
  `generated.body_sha256` — squash and rebase merges can no longer silence
  it by rewriting commit dates — so the published config schema
  (`schemas/config/okfit-1.0.0.json`) now documents `"warn"` as the
  default too. [#49][#49]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#49]: https://github.com/spencerbeggs/okfit/pull/49

## 0.2.0

### Features

- First usable release of `@okfit/core`: spec-level [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v0.2 support for [Effect](https://effect.website) v4, with no Node-only imports and no opinions beyond the spec itself.

#### Config schema

- `OkfitConfig` decodes the spec 4.2 TOML shape end to end: `okf_version`, `bundle`, `lifecycle`, `actors`, `concepts`, `types`, `tags`, and `[lint]`'s sixteen severities. Unknown top-level keys are kept in `extensions` and flagged by `Validate.lint` rather than rejected. `lifecycle.default_stale_after` accepts `90d`, `12h`, `2w`, or `"90 days"`. `OkfitConfig.merge` deep-merges tables (arrays and scalars in `override` replace wholesale), so a caller composes `DEFAULTS < profile < file` itself. `okfitConfigDocumentFields` is the single source the published JSON Schema (`schemas/config/okfit-1.0.0.json`) is generated from.

```ts
import { OkfitConfig } from "@okfit/core";

const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, yield* OkfitConfig.read("/repo/.config/okfit.toml"));
```

#### Frontmatter schemas

- Typed schemas for every OKF frontmatter family: `Actor`, `Timestamp`, `Source`, `Generated`, `Verification`, `Status`, and `AttestedComputation`, plus `Concept` and `ConceptId` for a decoded concept document.

#### Bundle loading

- `Bundle.load({ root })` reads an entire OKF bundle and never fails on bad content — malformed files become `Diagnostic`s instead of thrown errors, so a caller always gets a bundle back.

#### Link graph

- `Graph.fromBundle` builds the concept link graph. A path-valued field or link whose resolved target lands outside the bundle root is treated as an external reference — no graph node, no `broken-links` diagnostic — exactly like a URL.

#### Derivation

- `Derive` computes trust tier and staleness, and renders `index.md`/`log.md` documents from bundle data (`Derive.renderLog` assembles a whole log from dated groups).

#### Validation

- `Validate.all` and `Validate.lint` run conformance checks and the sixteen `[lint]` rules against a loaded bundle and its merged config.

#### JSON Schema

- `lib/scripts/generate-schema.ts` publishes `schemas/config/okfit-1.0.0.json` from the config's own annotated struct, so editors and CI can validate `.okfit.toml` without depending on this package directly. [#16][#16]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#16]: https://github.com/spencerbeggs/okfit/pull/16

## 0.1.0

### Features

- Bootstrap the okfit monorepo with package skeletons for core, profiles, cli, mcp, plugin, and the Claude Code plugin.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!
