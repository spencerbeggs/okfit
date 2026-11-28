# @okfit/core

## 0.16.0

### Features

#### Confined reads

- `Bundle.load` now reads every file confined at the moment of reading, so a symlink swapped in after the walk cannot pull outside content into a bundle (#460). The primitives are public:

- `readConfinedBytes` and `readConfinedString` read a file only if it still resolves inside the bundle root

- `ConfinementError` is the failure, with a reason of `outside`, `unresolvable` or `changed`

- `IndexDocument` and `LogDocument` carry an optional `source`: the text the load read, without a leading BOM.

- `changedWhileRead(subject)` is the one spelling of the transient wording, `"<subject>" changed while it was read; try again`, which `ConfinementError` and the CLI, engine and MCP messages share.

- A file that changed while it was being read becomes a `read-changed` diagnostic instead of a load failure.

#### New `read-changed` lint

- The `read-changed` code (lint key `read_changed`, default `warn`) reports a file that changed while the bundle was read. The `[lint]` table now has 44 keys.

* New `DiagnosticRange.forFrontmatterKey(document, path)`, the range of a written mapping key, for an edit whose value has no text of its own (#467)
* New `Concept.isAbsent(value)`, the OKF 0.3 rule that `undefined`, `null`, an empty string and an empty list read as absent (#466)

- New `GENERATED_AT_TOLERANCE_TEXT` export, the tolerance in words. Every message that names the `generated.at` tolerance now reads it from `GENERATED_AT_TOLERANCE`, so the two cannot drift apart. No message text changes (#506)

### Bug Fixes

- `symlink-escape` now also covers a directory symlink that resolves out of the bundle, and any link that cannot be resolved (dangling, a loop, or unreadable). A pruned name (`node_modules` by default) is silent for a file link too: the link is never read or reported. Hidden names are reported only with `includeHidden`
- `missing-index` no longer fires for a directory whose `index.md` exists but failed to load; the load failure is reported once instead (#512)
- `missing-index` is not reported for a directory whose `index.md` was refused as `read-changed`; only `read-changed` reports it

* The `generated-at-future` lint message and its description in `schemas/1.0/config.json` now say to run `okfit sync`, which re-stamps it to now (commit any edits to it first)

- A source's `usage_window` is decoded key by key, so a good `from` beside a bad `to` is kept and only the bad key is reported (#461)
- `broken-links` now checks the `#heading` of a path field (`superseded_by`, `resource`, `sources[].resource`, `computation`, `executor.resource`, `attester.resource`) against its target concept, as it does for a body link (#463)
- `generated-missing` now fires for a `generated` written without a readable `generated.by` (`generated: {}`, no `by`, a non-mapping) and for a concept with only a legacy `timestamp`, each with a message that says to set `generated.by` by hand, because `okfit sync` cannot fill either in (#466)
- `generated-missing` no longer promises that `okfit sync` will create the block for a `generated` written as `""`, `[]`, `!!null` or `&a ~`, or in a flow-style frontmatter block, or as an explicit `? generated` key: those get the hand-edit message (#466)
- A diagnostic for a bare `key:` or a tagged empty value (`generated: !!null`) now points at the key's own line instead of the first line of the frontmatter; `DiagnosticRange.forFrontmatterPath` still returns only a value's own text
- An unquoted root `okf_version` such as `0.10` is read as written (0.10, current) instead of as YAML's number 0.1, which kept the v0.2 fallbacks; unquoted text that is not a `<major>.<minor>` pair (`.2`, `1e1`) declares that text and reads as current; the warning shows the written value and says to quote it (#467)
- The `broken-links` and `generated-missing` descriptions in the config JSON Schema now say what they report

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.29.0 | ^0.30.0 |
| @effected/walker | peerDependency | updated | ^0.30.0 | ^0.31.0 |

## 0.15.0

### Breaking Changes

- `[bundle] non_concepts` now rejects a glob whose `[` or `{` never closes. A config such as `non_concepts = ["[a-"]` that loaded before now fails to load. To match the character itself, write `'\['` in single quotes or `"\\["` in double quotes.

* `OKF_SPEC_VERSION` is now `"0.3"`, and `OkfitConfig.DEFAULTS` no longer carries `okf_version`. The `okf_version` config key now only fills a root `index.md` that declares no version; a bundle's own declaration is never overwritten.

* Required keys are judged more strictly: a required key written as null, an empty string or an empty list is reported by `required-key-missing` with the message "is empty". By the same alignment, `field-value-unknown` no longer fires on an empty value, and `generated-missing` now fires on `generated: ""` or `[]`. A single-mapping frontmatter family whose every key was dropped as malformed now reads as absent instead of an empty object.

* `LintCode` gains the literals `resource-outside-project`, `superseded-by-orphan` and `superseded-by-unresolved`. A consumer that holds an exhaustive `Record<LintCode, ...>` or switches over every code must add them.

- `Derive.trustTier` now follows OKF 0.3 §5.3: it counts only current verification events, for every bundle whatever `okf_version` it declares. An event is current when it is dated at or after the concept's `generated.at`, or when `generated` or `generated.at` is absent. Earlier events stay in the file as history and count for nothing, so a concept's tier can drop after its content changes. Re-run `okfit verify` on concepts that now report a lower tier or the new `verified-before-change` warning.

#### Markdown without frontmatter or `type` is skipped, not an error

- Per OKF v0.3 §3.2, a `.md` file with no frontmatter or no `type` is no longer a conformance error. It is skipped with a warning: `frontmatter-missing` or `type-missing` (default `warn`; configure with the `frontmatter_missing` and `type_missing` keys). A bundle that holds a README no longer exits 2. A frontmatter block that is a YAML list or scalar is still a conformance error, now reported as `frontmatter-unparseable`.

#### Tolerant reading of values (OKF v0.3 §11.2)

- `null`, an empty string and an empty list read as absent.
- A single item reads as a list of one for `tags`, `sources`, `verified` and `parameters`.
- An entry is ignored only when it lacks a required key (`entry-ignored`); a malformed optional key is dropped alone (`value-malformed`); a value outside its vocabulary is kept (`value-unknown`, today `status`).
- These are warnings, so a bundle whose only errors were `family-invalid` on spec-defined values now exits 0. `family-invalid` remains an error only for okfit's own `x-okfit-integrity` family.

#### Type-level breaks

- `ConformanceCode` loses `frontmatter-missing` and `type-missing`; both are now `LintCode` members.
- `Derive.status` returns `DerivedStatus`, which adds `unknown`. `Staleness` gains `malformed`. `PathField` gains `superseded_by`.
- `Timestamp` accepts a date-only value (`YYYY-MM-DD`, read as midnight UTC) everywhere it is used.
- `superseded_by` moves out of `Concept.extensions` into a typed field. A bundle that already used it as an extension key now gets a graph edge, and a `broken-links` warning when its target is missing.

#### Tolerant reading can raise a trust tier

- A `verified` list with one good and one bad entry used to be dropped whole, so the concept read as unverified. It now keeps the good entry and warns about the bad one, so the concept can reach a higher trust tier than before.

#### Other behavior changes

- A symbolic link that resolves outside the bundle root is not listed or read (`symlink-escape`, warn).
- `UsageWindow.from` and `to`, `ComputationExecutor.resource` and `receipt`, and `ComputationAttester.resource` are now optional.
- `LoadedConcept.computationBody` is, for a bundle that declares OKF 0.3 or later, the code of the first fenced block in the `Computation` section at any heading level. For 0.2 or undeclared bundles it is unchanged.
- A bare link or path-field value falls back to the bundle root only for a bundle that declares 0.2 or earlier, or nothing.

* okfit's integrity block moves under the OKF v0.3 producer prefix: the frontmatter key is now `x-okfit-integrity` (same shape: `generated.body`, `verified.{by,at,content}`). A concept that still carries a bare `integrity` block no longer decodes into `Concept.integrity`, so okfit does not see its recorded digests or verifications. `Concept.integrity` and the `Integrity` classes keep their names.

* Run `okfit sync` once per bundle to rename the key in place. Until then, earlier verifications report as no longer current.

### Features

- New lint `generated-at-future` (config key `[lint] generated_at_future`, default `warn`). It fires on a `generated.at` more than 5 minutes later than now. A second message says when `okfit sync` will not re-stamp it, because re-stamping would make a verification count.
- `LintCode` gains `generated-at-future`; an exhaustive `Record<LintCode, ...>` needs the new member.
- New exports `GENERATED_AT_TOLERANCE`, `generatedAtIsFuture` and `verificationBlockingRestamp`.
- `ValidateOptions` takes a `configPath`, which messages that name the config file print.
- `OkfitConfig.read` reports every invalid key in one error, not only the first.

* New lint `computation-missing` (config key `[lint] computation_missing`, default `warn`). It fires on an Attested Computation that has no `computation` key and no computation under the bundle's declared reading.
* New lint `config-okf-version-stale` (config key `[lint] config_okf_version_stale`, default `warn`). It fires when the config sets `okf_version` and the bundle-root `index.md` declares a different one.

- Three new lint codes: `resource-outside-project` (default `info`), `superseded-by-orphan` and `superseded-by-unresolved` (default `warn`). The config schema document gains their keys (thirty-eight in all); the schema version stays `1.0`.
- New public API: `Graph.replacement`, `Derive.malformedStaleAfter` with the `MalformedStaleAfter` type, `RenderIndexOptions.metadata`, and `Bundle.parseDocument`, which returns a `Result` of `@effected/markdown`'s `MarkdownDocument` or `MarkdownParseError`.
- For a bundle that declares 0.3, a computation fence nested in a list item or block quote is found.

#### Non-concept Markdown lint

- OKF 0.3 §3.2 allows Markdown files in a bundle that are not concepts, such as a `README.md`. okfit now lets a project say which ones.

- New config key `[bundle] non_concepts`: a list of globs, relative to the bundle root, naming the `.md` files that may be non-concepts. core sets no default. An invalid glob fails config validation.

- New lint `non-concept-unlisted` (config key `non_concept_unlisted`, default `warn`). It fires on a `.md` file that has no frontmatter or no `type` and matches no `non_concepts` glob. It stays silent when `non_concepts` is absent, so a project that does not opt in sees no change. `type-missing` and `frontmatter-missing` are unchanged. There are now forty lint keys.

```toml
[bundle]
non_concepts = ["**/README.md", "docs/notes/**"]
```

#### Reading a bundle as another OKF version would

- `Graph.resolve` takes an optional fifth argument, a `FallbackRule` (`"declared" | "legacy" | "current"`, now an exported type), to resolve a reference as an OKF 0.2 or 0.3 reader would, whatever the bundle declares. The default is unchanged.
- `Bundle.inlineComputation(document, reading)` reads an inline computation with the v0.2 or the v0.3 locator.

* New `Derive.isCurrent(concept, at)`, which answers whether a verification event at `at` is current. It reads only `generated`, so a caller without a whole concept can pass `{ generated }`.
* New `Derive.currentVerifications(concept)`, which returns the current `verified` entries in list order.
* New lint `verified-before-change` (default `warn`, config key `verified_before_change`; the config schema document now has thirty-nine keys, and the schema version stays `1.0`). It fires when events dated before the last change would have given a higher tier than the current ones, and names the newest event that lost its weight. Draft, deprecated and unknown-status concepts are exempt.

- New `OkfVersion` module: parse, compare, read a bundle's declared version, and the legacy gate.
- The root `index.md` may carry `title`, `description`, `license` and extension keys. `IndexDocument` exposes them and the raw frontmatter; the `index-metadata-invalid` lint checks them.
- `Derive.renderIndex` keeps existing root frontmatter (`RenderIndexOptions.frontmatter`).
- Date-only timestamps read as the start of that day in UTC.
- `superseded_by` is a typed field, a path field and a graph edge.
- `DerivedStatus` adds `unknown`, and `Derive.rawStatus` returns the raw value. `Staleness` adds `malformed`.
- `team:` is a known actor scheme, and `actor-prefix-unknown` also checks `sources[].author`.
- `EntryPaths` and `Concept.entryPath` give the YAML position of each kept list entry.
- `computation-runtime-missing` also fires when `runtime` is present but unreadable.

* New exports `INTEGRITY_KEY` (`"x-okfit-integrity"`) and `OKFIT_KEY_PREFIX` (`"x-okfit-"`), the single source for every reader and writer of okfit's keys.
* Lint rule descriptions name `x-okfit-integrity` and `x-okfit-renders` in place of the old spellings.

### Bug Fixes

- The `config-okf-version-stale` message names the config file. It no longer offers an unparsable version as the value to set.

* `require-verified-unmet` on a concept with an unknown status now names a way out (set the status first, or verify with `okfit verify --stable` or `--draft`) instead of the bare "requires a verified entry" message.

- The `computation-missing` messages now match how the bundle is read, as OKF 0.2 or 0.3. The description of its config key says the same.
- When `non_concepts` is empty, the `non-concept-unlisted` message says the list allows no non-concept file.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | peerDependency | updated | ^0.29.0 | ^0.30.0 |

## 0.14.0

### Features

- Adds the `resource-ignored` (default `error`) and `resource-untracked` (default `warn`) lint codes and their `[lint]` keys `resource_ignored` and `resource_untracked`, for a `resource` or `sources[].resource` that exists locally but is gitignored or not tracked by git. The config JSON Schema is regenerated.

## 0.13.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.28.0 | ^0.29.0 |
| @effected/glob | peerDependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/walker | peerDependency | updated | ^0.29.0 | ^0.30.0 |

## 0.13.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.27.0 | ^0.28.0 |
| @effected/glob | peerDependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/schemastore | peerDependency | updated | ^0.32.0 | ^0.33.0 |
| @effected/walker | peerDependency | updated | ^0.28.0 | ^0.29.0 |

## 0.13.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/walker | peerDependency | updated | ^0.27.0 | ^0.28.0 |

## 0.13.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/glob | peerDependency | updated | ^0.20.0 | ^0.21.0 |
| @effected/jsonc | peerDependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/markdown | peerDependency | updated | ^0.28.0 | ^0.29.0 |
| @effected/schemastore | peerDependency | updated | ^0.31.0 | ^0.32.0 |
| @effected/source | peerDependency | updated | ^0.4.0 | ^0.5.0 |
| @effected/toml | peerDependency | updated | ^0.19.1 | ^0.20.0 |
| @effected/walker | peerDependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/yaml | peerDependency | updated | ^0.29.0 | ^0.30.0 |
| effect | peerDependency | updated | ~4.1.2 | ~4.1.0 |

[#370][#370]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#370]: https://github.com/spencerbeggs/okfit/pull/370

## 0.13.1

### Bug Fixes

- The `footnote-undefined` lint reads the markdown parser's unresolved footnote markers, so an escaped `\[^x]`, a label that differs only in case from its definition (`[^Foo]` against `[^foo]:`), and an indented or list-item definition no longer warn. These were false positives, and markdownlint MD052 agrees.
- The `footnote-source-unknown` lint reads parsed references and definitions instead of matching text, with identical results on every fixture. An escaped marker is no longer checked.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.25.0 | ^0.26.0 |
| @effected/glob | peerDependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/markdown | peerDependency | updated | ^0.27.0 | ^0.28.0 |
| @effected/schemastore | peerDependency | updated | ^0.30.0 | ^0.31.0 |
| @effected/walker | peerDependency | updated | ^0.25.1 | ^0.26.0 |

[#367][#367]

### Maintenance

- Actor allow-list matching, posix path arithmetic and frontmatter fence detection now use the effected kit's `Wildcard`, `PosixPath` and `FrontmatterSource.split`, with no change in behavior. [#367][#367]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#367]: https://github.com/spencerbeggs/okfit/pull/367

## 0.13.0

### Breaking Changes

- The `broken-links` lint now resolves a `#fragment` against `github-slugger` slugs. Each space in a heading becomes one hyphen with no trimming or collapsing, underscores and combining marks are kept, and repeated headings always get unique slugs.

#### Migrating

- A link written to the old form now reports `broken-links`. The diagnostic names the new anchor, so each one can be fixed from its own message:

```text
Link target "b.md#a-b" exists but has no heading "#a-b"; did you mean "#a--b"?
```

- Run `okfit validate` after upgrading to find them. Headings with an em dash, an ampersand or an underscore are the likely ones: `## A — B` is now `#a--b`, and `## foo_bar` is now `#foo_bar`.

- Parity is with `github-slugger`, not with GitHub itself, whose algorithm is not public. [#362][#362]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/glob | peerDependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/jsonc | peerDependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/markdown | peerDependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/schemastore | peerDependency | updated | ^0.29.0 | ^0.30.0 |
| @effected/source | peerDependency | updated | ^0.3.0 | ^0.4.0 |
| @effected/toml | peerDependency | updated | ^0.19.0 | ^0.19.1 |
| @effected/walker | peerDependency | updated | ^0.25.0 | ^0.25.1 |
| @effected/yaml | peerDependency | updated | ^0.28.0 | ^0.29.0 |

[#362][#362]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#362]: https://github.com/spencerbeggs/okfit/pull/362

## 0.12.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/glob | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/jsonc | peerDependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/markdown | peerDependency | updated | ^0.25.0 | ^0.26.0 |
| @effected/schemastore | peerDependency | updated | ^0.28.0 | ^0.29.0 |
| @effected/source | peerDependency | updated | ^0.2.0 | ^0.3.0 |
| @effected/toml | peerDependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/walker | peerDependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/yaml | peerDependency | updated | ^0.27.0 | ^0.28.0 |
| effect | peerDependency | updated | ~4.1.1 | ~4.1.2 |

[#357][#357]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#357]: https://github.com/spencerbeggs/okfit/pull/357

## 0.12.0

### Breaking Changes

- `Derive.renderIndex` and `Derive.synthesizeIndex` now render `index.md` through `@effected/markdown`'s emitter instead of string templates. Titles and descriptions are escaped only where markdown would read them as syntax (`node_modules` stays as written, `<pkg>` becomes `\<pkg>`), a link target containing a space is written in angle brackets, and the root frontmatter is emitted as `okf_version: '0.2'`. The parsed entries are unchanged. Existing `index.md` files are rewritten to the new form the next time `okfit sync` runs. [#354][#354]

### Bug Fixes

- `Graph.fromBundle` now ranges each frontmatter edge at its own field, found by its YAML path (`resource`, `sources[i].resource`, `computation`, `executor.resource`, `attester.resource`). Before, a path that appeared twice, such as under both `resource` and `sources`, or earlier in a YAML comment, gave every edge the first occurrence's position. For a double-quoted value, the edge's range now covers the quotes, matching frontmatter lint diagnostics. [#354][#354]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/glob | peerDependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/jsonc | peerDependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/markdown | peerDependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/schemastore | peerDependency | updated | ^0.27.0 | ^0.28.0 |
| @effected/source | peerDependency | updated | ^0.1.0 | ^0.2.0 |
| @effected/toml | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/walker | peerDependency | updated | ^0.22.0 | ^0.24.0 |
| @effected/yaml | peerDependency | updated | ^0.26.0 | ^0.27.0 |
| effect | peerDependency | updated | ^4.0.0 | ~4.1.1 |

[#354][#354]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#354]: https://github.com/spencerbeggs/okfit/pull/354

## 0.11.8

### Bug Fixes

- Diagnostic positions that land on the `\n` of a `\r\n` line ending no longer report character `-1`.
- `DiagnosticRange.fromOffset` clamps an offset past the end of the text to the end, and throws a `RangeError` for a non-integer offset. [#339][#339]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/glob | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/jsonc | peerDependency | updated | ^0.20.0 | ^0.21.0 |
| @effected/markdown | peerDependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/schemastore | peerDependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/toml | peerDependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/walker | peerDependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/yaml | peerDependency | updated | ^0.25.0 | ^0.26.0 |
| @effected/source | peerDependency | added | — | ^0.1.0 |

[#339][#339]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#339]: https://github.com/spencerbeggs/okfit/pull/339

## 0.11.7

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.20.0 | ^0.21.0 |
| @effected/glob | peerDependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/walker | peerDependency | updated | ^0.20.0 | ^0.21.0 |

[#334][#334]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#334]: https://github.com/spencerbeggs/okfit/pull/334

## 0.11.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/markdown | peerDependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/walker | peerDependency | updated | ^0.19.0 | ^0.20.0 |

[#320][#320]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#320]: https://github.com/spencerbeggs/okfit/pull/320

## 0.11.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/jsonc | peerDependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/markdown | peerDependency | updated | ^0.20.0 | ^0.22.0 |
| @effected/schemastore | peerDependency | updated | ^0.25.0 | ^0.26.0 |
| @effected/toml | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/yaml | peerDependency | updated | ^0.23.0 | ^0.25.0 |

[#316][#316]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#316]: https://github.com/spencerbeggs/okfit/pull/316

## 0.11.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/glob | peerDependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/jsonc | peerDependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/markdown | peerDependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/schemastore | peerDependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/toml | peerDependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/walker | peerDependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/yaml | peerDependency | updated | ^0.22.0 | ^0.23.0 |

[#310][#310]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#310]: https://github.com/spencerbeggs/okfit/pull/310

## 0.11.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | peerDependency | updated | ^0.18.0 | ^0.19.0 |

[#303][#303]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#303]: https://github.com/spencerbeggs/okfit/pull/303

## 0.11.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/glob | peerDependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/jsonc | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/markdown | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/schemastore | peerDependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/toml | peerDependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/walker | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/yaml | peerDependency | updated | ^0.21.0 | ^0.22.0 |

[#300][#300]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#300]: https://github.com/spencerbeggs/okfit/pull/300

## 0.11.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/glob | peerDependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/jsonc | peerDependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/markdown | peerDependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/schemastore | peerDependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/toml | peerDependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/walker | peerDependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/yaml | peerDependency | updated | ^0.20.0 | ^0.21.0 |

[#292][#292]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#292]: https://github.com/spencerbeggs/okfit/pull/292

## 0.11.0

### Features

#### Link resolution

- `Graph.resolve(bundle, from, raw)` resolves one reference the way the link graph does and reports which rule matched (`via`: rooted, file-relative or bundle-root-relative).

### Bug Fixes

#### Missing directory indexes

- `missing-index` now also flags a directory that holds no concept itself but is the ancestor of one, which its parent index links to. `Derive.indexDirectories(bundle)` lists every directory that owes an `index.md`. [#284][#284]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#284]: https://github.com/spencerbeggs/okfit/pull/284

## 0.10.0

### Breaking Changes

- `[actors].humans` entries decode as the new `ActorPattern` type instead of `Actor`, so they may be id globs such as `human:spencer*`. Code that read `config.actors.humans` as `ReadonlyArray<Actor>` now receives `ReadonlyArray<ActorPattern>`.

* The `BodySha256` export is removed. Digests now live in an okfit-owned top-level `integrity` frontmatter family, modeled by the new `Integrity` and `Digest` exports.

* Migrate imports of `BodySha256` to `Digest` (a 16-hex truncated SHA-256) and read generated digests from `integrity.generated.body` instead of `generated.body_sha256`.

### Features

- New `Integrity` frontmatter family holding `generated.body` and `verified { by, at, content }`
- New `verified-drift` lint, registered with a default severity of `warn`, for concepts edited after they were verified [#278][#278]

* New `ActorPattern` schema and the `Actor.matches`, `Actor.allowed` and `Actor.isPattern` helpers for `[actors].humans` allow-lists
* New `actor-email` lint (default `warn`) for an actor carrying an email address in a concept or in `[actors].humans`
* New `verified-actor-unknown` lint (default `warn`) for a human verifier that a non-empty `[actors].humans` does not list
* The verified-drift lint also fires when the bound verifier is not in a non-empty \[actors\].humans [#281][#281]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/glob | peerDependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/jsonc | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/markdown | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/schemastore | peerDependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/toml | peerDependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/walker | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/yaml | peerDependency | updated | ^0.19.0 | ^0.20.0 |
| effect | peerDependency | updated | 4.0.2 | 4.0.2 |

[#282][#282]

[#277][#277]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#277]: https://github.com/spencerbeggs/okfit/pull/277

[#278]: https://github.com/spencerbeggs/okfit/pull/278

[#281]: https://github.com/spencerbeggs/okfit/pull/281

[#282]: https://github.com/spencerbeggs/okfit/pull/282

## 0.9.2

### Bug Fixes

- Broken-link anchor diagnostics now name the candidate headings: the message offers `did you mean "#slug"?` when a close match exists, lists the target's headings otherwise, and says the target has no headings when it has none. [#267][#267]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#267]: https://github.com/spencerbeggs/okfit/pull/267

## 0.9.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | peerDependency | updated | ^0.20.0 | ^0.21.0 |

[#251][#251]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#251]: https://github.com/spencerbeggs/okfit/pull/251

## 0.9.0

### Features

- Add three lint codes to `LintCode` and the `[lint]` config table: `publication-drift` (default `warn`), `publication-orphan` (default `error`), and `surface-unmatched` (default `warn`).
- Regenerate the published config JSON Schema so editors accept the new severities. [#237][#237]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#237]: https://github.com/spencerbeggs/okfit/pull/237

## 0.8.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | peerDependency | updated | ^0.18.0 | ^0.20.0 |

[#235][#235]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#235]: https://github.com/spencerbeggs/okfit/pull/235

## 0.8.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/glob | peerDependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/jsonc | peerDependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/markdown | peerDependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/schemastore | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/toml | peerDependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/walker | peerDependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/yaml | peerDependency | updated | ^0.18.0 | ^0.19.0 |
| effect | peerDependency | updated | 4.0.0-rc.118 | ^4.0.0 |

[#225][#225]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#225]: https://github.com/spencerbeggs/okfit/pull/225

## 0.8.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/walker | peerDependency | updated | ^0.13.0 | ^0.14.0 |

[#203][#203]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#203]: https://github.com/spencerbeggs/okfit/pull/203

## 0.8.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | peerDependency | updated | ^0.16.0 | ^0.17.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.8.1

### Bug Fixes

- Kept the `pattern` constraints for actors, timestamps, generated sha256 values and the config `stale-after` field in generated JSON Schema, which `effect` rc.118 would otherwise drop [#196][#196]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | peerDependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/glob | peerDependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/jsonc | peerDependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/markdown | peerDependency | updated | ^0.12.0 | ^0.14.0 |
| @effected/schemastore | peerDependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/toml | peerDependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/walker | peerDependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/yaml | peerDependency | updated | ^0.17.0 | ^0.18.0 |
| effect | peerDependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#196]: https://github.com/spencerbeggs/okfit/pull/196

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
