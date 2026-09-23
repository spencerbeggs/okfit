# @okfit/core

## 0.8.0

### Features

#### Lint and profile diagnostics now range at the offending value

- `Diagnostic.range` and `ProfileDiagnostic.range` used to anchor at the whole frontmatter block. They now anchor at the specific value a rule is complaining about — the `type` value for `unknown-type`, the `stale_after` value for `stale`, the offending value for `field-value-unknown`, and so on — falling back to the frontmatter block only when a rule has no more precise path (an absent key, or a bundle-level check with no concept to point at). A quoted scalar's range includes its delimiting quotes, since the underlying YAML parse reports it that way.

- The new entry point is a public static:

```ts
import { DiagnosticRange } from "@okfit/core";

const range = DiagnosticRange.forFrontmatterPath(document, ["generated", "at"]);
```

- It returns `undefined` when the document has no frontmatter block at all, and falls back to the whole-block range when the named path can't be found. `@okfit/profiles` and `@okfit/engine` both consume it to range their own diagnostics; see their changesets. [#179][#179]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#179]: https://github.com/spencerbeggs/okfit/pull/179

## 0.7.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/glob | peerDependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/jsonc | peerDependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/markdown | peerDependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/schemastore | peerDependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/toml | peerDependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/walker | peerDependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/yaml | peerDependency | updated | ^0.16.0 | ^0.17.0 |
| effect | peerDependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |

[#173][#173]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#173]: https://github.com/spencerbeggs/okfit/pull/173

## 0.7.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/walker | peerDependency | updated | ^0.10.0 | ^0.11.0 |

[#169][#169]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#169]: https://github.com/spencerbeggs/okfit/pull/169

## 0.7.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/glob | peerDependency | updated | ^0.6.0 | ^0.7.0 |
| @effected/jsonc | peerDependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/markdown | peerDependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/schemastore | peerDependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/toml | peerDependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/walker | peerDependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/yaml | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| effect | peerDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

[#162][#162]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/okfit/pull/162

## 0.7.1

### Bug Fixes

- fixes pnpm v12 clsure issues

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.7.0

### Features

#### The config JSON Schema contract, whole

- Core now owns every part of the config file's JSON Schema, beside the `okfitConfigDocumentFields` struct that defines its shape:

- `CONFIG_SCHEMA_VERSION` (`"1.0"`), the schema's `major.minor` label.

- `okfitConfigSchemaHost`, the hosted identity, whose `versions` derive from that label; and `SCHEMA_DIRECTIVE`, the `#:schema` line a config file opens with. Both moved here from `@okfit/engine`.

- The schemastore build itself (`lib/configs/schemastore.config.ts`, `pnpm schema:build` / `schema:check`), which publishes the document to the repo's `schemas/` tree. The published document is unchanged.

- `@effected/schemastore` is a new peer dependency. [#139][#139]

#### New lint rule: `generated-missing`

- A concept with no `generated:` block is now flagged at validate time when `actors.agent` is configured, instead of surfacing only as a skip in `okfit sync`'s post-commit output. Configure its severity under the `[lint]` table's new `generated_missing` key (default `"warn"`); the rule is silent when `actors.agent` is unset.

```toml
[lint]
generated_missing = "warn" # or "error" / "off"
```

- The config JSON Schema is regenerated to include the new key. [#141][#141]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#139]: https://github.com/spencerbeggs/okfit/pull/139

[#141]: https://github.com/spencerbeggs/okfit/pull/141

## 0.6.0

### Maintenance

- Changes generation and URL of schema to `@okfot/engine` package.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.0

### Features

#### Two new lint codes

- `status-missing` (`lint.status_missing`, default `"off"`) reports a concept that carries neither `status` nor a `verified` entry, since the spec reads an absent `status` as `stable` and that silently hides an unfinished concept.
- `source-resource-missing` (`lint.source_resource_missing`, default `"warn"`) reports a `resource` or `sources[].resource` value that does not resolve to a file, either in the bundle or on disk relative to the concept.

#### `broken-links` checks link fragments

- A link like `[Foo](./bar.md#section)` is now flagged when `bar.md` exists but has no `#section` heading, not only when the target file itself is missing.

### Bug Fixes

- `footnote-undefined` and `footnote-source-unknown` no longer misreport a footnote-shaped token (`[^1]`) that appears inside an inline code span or a fenced code block as an actual footnote reference.
- Generated `index.md` entries now backslash-escape markdown-active characters (``\ < > * _ ` [ ]``) in a concept's title and description, so text containing them renders as literal characters instead of being interpreted as emphasis or inline HTML. [#120][#120]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#120]: https://github.com/spencerbeggs/okfit/pull/120

## 0.4.1

### Bug Fixes

- `footnote-source-unknown` now says the label must equal a `sources[].id` exactly and lists the declared ids, so a shortened label is a one-step fix [#90][#90]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#90]: https://github.com/spencerbeggs/okfit/pull/90

## 0.4.0

### Features

- New lint code `footnote-undefined` (default `warn`, configurable via `[lint].footnote_undefined`): flags a `[^label]` footnote reference in a concept's body that has no matching `[^label]: ...` definition line. Complements `footnote-source-unknown`, which only checks a label against `sources[].id`.

### Bug Fixes

- `require-verified-unmet` no longer fires on a concept with `status: draft` — a draft is unsettled by definition, so it is exempt from the type's `require_verified` requirement.
- Adapted to `@effected/walker` 0.9.0: an unreadable directory entry now carries the underlying `PlatformError` reason, and the `walk-unreadable` diagnostic names it instead of reporting the directory alone.
- The published config JSON Schema (`schemas/config/okfit-1.0.0.json`) closes every declared table again; since `effect@4.0.0-rc.113` left structs open by default it had temporarily accepted unknown keys inside declared tables. Unknown *top-level* keys remain permitted, unchanged. [#64][#64]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#64]: https://github.com/spencerbeggs/okfit/pull/64

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
