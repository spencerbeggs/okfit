# @okfit/core

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
