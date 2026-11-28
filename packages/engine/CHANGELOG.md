# @okfit/engine

## 0.23.0

### Breaking Changes

- `planMigrationFixes` and `applyMigrationFixes` no longer declare `YamlParseError` in their error channel; neither could fail with it. A caller that wrote `Effect.catchTag("YamlParseError", ...)` on either now fails to compile. Remove that handler: the only error left is `PlatformError`.

### Features

- `SkipReason` gains `index-unparseable` and `changed-during-read`; `VerifyBatchSkipReason` gains `changed-during-read`; `MoveError`, `QueryConceptNotFoundError`, `VerifyConceptNotFoundError` and `TargetFailure` gain the reason `changed-during-read`
- `okf-version-undeclared` now names a root index that is unclosed or unparseable, instead of reporting the version as merely missing (#512)

* `VerifySelectionError` gains the public reasons `at-malformed` (an `--at` that is not a timestamp) and `status-needs-one-concept` (`--stable` or `--draft` with targets that resolve to more than one concept). A consumer that matches `reason` exhaustively must add both.

- `SyncResult.clockBehind` (`now`, `latest`, `concepts`) and the optional `clock_behind` key on `SyncEnvelope` report a run that saw a `generated.at`, or a changed concept's commit date, more than the tolerance ahead of the clock (#509)
- `ResolvedProjectConfig.configPath` carries the discovered config file's path; `RunOptions.configPath` and `BundleSessionOptions.configPath` now accept `undefined` (#506)

### Bug Fixes

- `okfit sync` keeps a file's CRLF or LF line endings when it rewrites `index.md` and `log.md` (#505)
- `okfit sync` never overwrites an `index.md` it could not read (#512)
- When a file changed during the load, sync holds back the indexes and log that would list it and the changed concept's own stamp; other concepts' stamps are still written, so a bundle that lost a file to a concurrent save is never written from
- `okfit mv` and `migrate --fix` refuse when a file changed during the load
- Containment checks now judge the whole path, not only its last segment (#460)
- The sync stale check compares each target with the text the bundle load read, so an edit that lands between the load and the plan is refused with `SyncPlanStaleError` instead of overwritten
- `okfit sync` refuses an `index.md` or `log.md` that was absent at the load and created before the plan: the index write fails `SyncPlanStaleError` at apply instead of overwriting it, and a log that appeared is skipped as `changed-during-read`, never as `log-unparseable`
- `PublicationNotFoundError` gains an optional `reason` of `changed-during-read`: `stampPublication` answers a Publication or render source that changed during the load with `"<path>" changed while it was read; try again` instead of "no concept"
- `makeOverlayFileSystem` answers the read-only `open` and `realPath` a confined read needs, so unsaved overlay documents read the same way as files on disk
- `ConceptQuery.get`, `ConceptQuery.neighbors`, `Targets.resolve` and `okfit verify <id>` answer a concept that changed during the load with `"<path>" changed while it was read; try again` (reason `changed-during-read`) instead of "no concept"

* The message of the `future` `VerifyNotCurrentError` now says the stamp is more than 5 minutes later than now and to run `okfit sync`, which re-stamps it to now (commit any edits to it first)
* `syncGenerated` now reports `generated-missing` before the uncommitted or untracked skip for a changed concept that has no generated block and no `actors.agent`, so the author is told the real blocker first (#515)

- `okfit sync` reports a held future stamp as `verified-after-now` on the run that holds it. A changed concept is still written, so it may now appear in both `written` and `skipped` (#509)
- A changed concept whose future stamp guards no verification dated after now is re-stamped to now on its first sync, so "commit, then run okfit sync" converges in one run (#509)

* `FrontmatterEdits.rendersDigests` writes the digest as the value of a bare `body:` or a `body: !!null` in a `renders` entry, instead of adding a second `body:` line (or, for a tagged null, a digest in front of `type:`) (#467)

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.1.5 | 4.1.6 |
| @effected/app | dependency | updated | 0.34.0 | 0.35.0 |
| @effected/config-file | dependency | updated | 0.29.0 | 0.30.0 |
| @effected/store | dependency | updated | 0.25.0 | 0.25.1 |
| @effected/walker | dependency | updated | 0.30.0 | 0.31.0 |
| @effected/xdg | dependency | updated | 0.22.0 | 0.23.0 |
| @okfit/core | dependency | updated | 0.15.0 | 0.16.0 |
| @okfit/profiles | dependency | updated | 0.16.0 | 0.16.1 |
| effect | dependency | updated | 4.1.5 | 4.1.6 |

## 0.22.0

### Breaking Changes

- `VerifyNotCurrentError` no longer has the optional `batch` field. A batch, an id list and the pickers now skip a concept that cannot be verified, so a concept that is not current no longer stops a whole selection. The error gains an optional `kind` (`"blocked"`, `"future"` or `"near-future"`) and, for `"blocked"`, an optional `blockedBy` (the verification that stops sync re-stamping the concept), and its message is reworded. Drop any read of `batch`; read `kind` to tell how far ahead the `generated.at` is.

* `loadPickerCandidates` and `loadStaleCandidates` now return `leftOut` as `ReadonlyArray<VerifySkip>`, sorted by id, instead of a sorted `ReadonlyArray<string>` of ids. Read `leftOut.map((entry) => entry.id)` to get the ids.

- `RunOptions.projectRoot` and `BundleSessionOptions.projectRoot` are now required.
- The JSON, graph and stale envelopes' `okf_version` is `string | null` and reports the bundle's own declaration.
- Verifying a concept whose status is outside the vocabulary fails with `VerifyStatusUnknownError` unless the same write sets the status. Batch verify skips such a concept with reason `unknown-status`. `VerifyResult.status.from` is the raw status text.
- The version-mismatch warning is removed.
- `ScaffoldOptions.okfVersion` is now required: `init`'s scaffold writes that version into the root index instead of the spec constant, so a caller building `ScaffoldOptions` must pass it.
- `StaleEnvelope` gains a required `malformed` array and `summary.malformed`, and the input of `staleEnvelope` requires `malformed`. `ConceptSummary` gains required `raw_status` and `staleness`, and `QueryGetEnvelope`'s concept gains a required `replacement` (`string | null`). Decoding an envelope written by an older engine with these schemas now fails.
- The output unions widened: `SkipReason` gains `symlink-escape`; `VerifyBatchSkipReason` and `VerifyBatchEnvelope.skipped[].reason` gain `unknown-status`. An exhaustive `switch` over either must handle the new literal.
- `VerifyEnvelope.status.from` is widened from `Status | null` to `string | null`, because the status being replaced may be outside the vocabulary.

* New `VerifyNotCurrentError` (exit code 3). `verify` now refuses to write a verification dated before the concept's `generated.at`, since OKF 0.3 §5.3 would not count it. This applies on every write path, including `stale --verify`, whether the early time came from `--at` or from a clock behind a future `generated.at`. A batch fails whole. Callers that handle verify failures exhaustively must handle the new error; the fix is to verify at or after `generated.at`.
* "Already verified" now requires a current binding, so batch verify and the interactive picker no longer skip a concept that was verified before its last change; it is selected again.
* The drift reason in verify, query and stale envelopes may now be `verified-before-change`. An exhaustive `switch` over drift reasons must handle it.

- okfit's frontmatter keys now carry the `x-okfit-` prefix, and the engine moves old bundles forward.

- `sync` renames the old keys in place: the `integrity` block becomes `x-okfit-integrity`, and each built-in profile field becomes its prefixed key, but only where the merged config declares the prefixed field for that concept's type, not the bare one, and the type's `required` list does not name the bare one. Quote style, values, comments and order are kept, the ids are reported as `migrated`, and a second run changes nothing.

- A concept that sync cannot stamp (uncommitted edits, untracked, no `generated` block) is still renamed, so an id can appear in both `migrated` and `skipped`.

- `SkipReason` gains `legacy-key-conflict` (a concept has both spellings of a key; nothing is written) and `legacy-key-unsupported` (the key cannot be renamed in place: a flow-style document, an alias or a `<<` merge in the old integrity block, a duplicated key or an explicit `?` key). An exhaustive `switch` over skip reasons must handle both.

- `VerifyUnsupportedFrontmatterError.key` is now `"x-okfit-integrity"` rather than `"integrity"`, and its `shape` gains `legacy-key`, raised when verify meets a concept that still carries the old block.

- `FrontmatterEdits.rendersDigests` takes the key spelling to edit, defaulting to `x-okfit-renders`.

- The migration fix refuses a concept that still uses the old keys and says to run `okfit sync` first; the other fixes still apply.

- Run `okfit sync` once per bundle. The content digest now excludes `x-okfit-integrity`, so renaming `integrity` loses no verification; renaming a profile key changes the digest, so a verified concept with a profile field needs `okfit verify` again.

### Features

- `okfit sync` keeps a root `index.md`'s existing frontmatter and only writes `okf_version` when the block declares none.
- `ConceptSummary.status` may be `unknown` for a concept whose status is outside the known vocabulary.

* `okfit sync` re-stamps a `generated.at` more than 5 minutes later than now, and caps a changed concept's new stamp at now. It never lowers a stamp when that would make a verification count: the re-stamp is skipped with the reason `verified-after-now`, the cap is not applied, and a changed concept's stamp is never moved back below the stamp it replaces when a verification falls between the two. `SyncSkip` is exported, and `SkipReason` gains `verified-after-now`.
* Verify skips a concept that cannot be verified at the verification time, with the skip reason `not-current`, in a batch or an id list. The picker loaders leave such rows out and return the ids as `leftOut`.
* `VerifyBatchSkipReason` gains `not-current`, and `notCurrentAt` is a new export. `VerifyOptions`, `VerifyBatchOptions` and `VerifyIdsOptions` take an optional `now`.
* `RunOptions.configPath` and `RunResult.legacyKeys` are new. `RevalidateResult.current` and the type `DiagnosticsByFile` are exported.

- `validate --target 0.3` and its `--fix` cover root-relative links in every Markdown file of the bundle (index files, `log.md`, typeless and frontmatter-less files), not only concepts.
- `--fix` holds the version change back, with one refusal per cause, while a reference still resolves only from the bundle root, while an Attested Computation would lose its computation, or while a Markdown file cannot be read.
- A malformed config error names the failing key and the reason, for example `malformed config <path>: lint.missing_index: Expected ...`.
- New export `readMarkdownSources` and its `MarkdownSources` type. `migrationFindings` takes an optional list of extra sources to scan for root-relative links.

* New exports `futureAtRefusal`, `notCurrentDetail`, `NotCurrentDetail` and `VerifySkip`.
* `loadPickerCandidates` accepts `now`, the instant a left-out row's not-current kind is judged against. It defaults to the clock.
* The `skipped` entries of a batch, an id list and `selectAttestable` are `VerifySkip`. A `not-current` skip carries `notCurrent`, and an `unknown-status` skip carries the raw `status`.
* `VerifySelectionError` gains the reason `at-future`. `runVerify`, `runVerifyBatch` and `runVerifyIds` refuse with it when given `now` and an `at` more than 5 minutes later than it.
* `runVerifyIds` skips a concept with an unknown status, with the reason `unknown-status`, and verifies the rest. It used to fail the whole call.

- Repository resources are checked only inside the project root. A value outside it is reported as `resource-outside-project` and is never read, stat'ed or passed to git.
- `ConceptSummary` gains `raw_status` and `staleness`; `ConceptFilter` gains `current` and accepts the `unknown` status; `ConceptQuery.get` gains `replacement`; `rawStatusOf` is exported.
- The stale envelope gains `malformed` and `summary.malformed`, listing unreadable `stale_after` values.
- `mv` rewrites `computation`, `executor.resource`, `attester.resource`, `superseded_by` and a single-mapping `sources`. It now runs on a bundle that holds non-concept `.md` files and rewrites their links (`ReferenceSource` is exported).
- `init` writes `title` and `description` into a new root index.
- `escapesBundle` and `escapesRoot` are exported: whether a reserved `index.md` or `log.md` is a symlink out of the bundle (a dangling link counts), the one check `sync`, `context` and the MCP server share.

#### Migration findings and safe fixes

- `migrationFindings(bundle, config, target)` reports what in a bundle reads differently under a target OKF version. Each `MigrationFinding` carries one of five `MigrationCode`s: `okf-version-undeclared`, `okf-version-older`, `okf-version-unparsable`, `root-relative-path` and `computation-locator`. A `computation-locator` finding is reported only when the Computation section reads differently under the target: a depth-one section that is exactly one fenced block reads the same and is not reported. A finding that has a safe fix names its `MigrationFixKind` (`okf-version` or `root-relative-path`).
- `planMigrationFixes` and `applyMigrationFixes` (options `MigrationFixOptions`, result `MigrationFixPlan`) carry out the two safe fixes: declaring `okf_version`, and rooting a bare reference that resolves only from the bundle root. Every edit is planned before any file is written, so a failure while planning writes nothing. `refused` lists a fix that was not planned, with the reason, and the other fixes still apply: the version fix is refused while a root-only reference remains, and when the root index frontmatter does not parse (malformed YAML or a duplicate key), in which case no `YamlParseError` escapes and the file is left as it was. `drifts` lists each edited concept whose okfit verification integrity was current before the edit, and each edited concept whose recorded body digest could not be re-recorded. A fix that repairs a link re-records the concept's generated body digest, so `generated.at` is kept. A fix never writes a verification.

#### `run` and the JSON report

- `run` accepts `target` and returns `migration`, the findings for that target (an empty list without one).
- Diagnostics have a fourth source, `"migrate"`. A migrate diagnostic never affects the exit code.
- The JSON envelope gains optional `target` and `fixes` (type `JsonFixes`: `applied`, `refused`, `drifts`, `dry_run`), and a diagnostic may carry `fix`.
- `summary.migration_findings` is a new field in JSON output. It is always present, and is `0` when no target was given. Code that validates the envelope against a closed shape must allow it.

* `sync` now stamps `generated.at` as the earlier of the derived instant and a human verification binding that covers exactly the current content. Content that was verified and then committed keeps its verification current instead of being outdated by the commit time. The clamp never moves `generated.at` backwards: when the binding is earlier than the concept's existing `generated.at` (a revert to previously verified content, or a hand-written binding), `sync` stamps the derived instant, and a concept with no `generated.at` is still clamped.

### Bug Fixes

- Resource findings are ranged correctly after an ignored `sources` entry.

* The 0.3 migration no longer reports an empty Computation section, and its refusal names the hand edit.
* A malformed config reports every invalid key, not only the first.
* Sync keeps a byte-order mark on `index.md` and `log.md`.

- `computation-locator` no longer requires `runtime`, and judges a CRLF Computation section the same as its LF twin.

* The move planner keeps a UTF-8 byte-order mark on the files it rewrites.
* When a move repairs links in a concept whose recorded body digest matched before, the digest is re-recorded, so the next sync keeps `generated.at`. A stale or missing digest, and a concept still on old key names, are not re-recorded.
* If a matching digest cannot be re-recorded because of the integrity block's layout, the concept is listed in `drifts`, even if no human verified it.
* For a root `index.md` whose frontmatter is never closed, `okf-version-undeclared` now carries a `fix`, and the migration refuses that fix with the reason.

- `sync` skips an `index.md` or `log.md` that is a symlink out of the bundle (skip reason `symlink-escape`).
- `sync` never stamps a version into a root index that declares none, unless the config names one.
- `context` reports `index_exists: false` for a root `index.md` that is a symlink out of the bundle or dangling, and never reads its target (it may resolve the link's real path to decide containment). The session-start hook therefore no longer prints such a file.
- A Surface `resource` glob with a leading `/` resolves from the bundle root, not from the Surface's directory.

* `init` no longer writes root `title` and `description` into a bundle that declares OKF 0.2 or earlier, where a strict reader rejects them (#468).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/glob | dependency | updated | 0.23.0 | 0.23.1 |
| @effected/markdown | dependency | updated | 0.29.0 | 0.30.0 |
| @okfit/core | dependency | updated | 0.14.0 | 0.15.0 |
| @okfit/profiles | dependency | updated | 0.15.2 | 0.16.0 |

## 0.21.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/git | dependency | updated | 0.33.0 | 0.34.0 |
| @okfit/profiles | dependency | updated | 0.15.1 | 0.15.2 |

## 0.21.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.1.4 | 4.1.5 |
| @effected/git | dependency | updated | 0.32.0 | 0.33.0 |
| @okfit/profiles | dependency | updated | 0.15.0 | 0.15.1 |
| effect | dependency | updated | 4.1.4 | 4.1.5 |

## 0.21.0

### Features

- The `ContextEnvelope` schema gains a `cli_version` field (`string | null`) and `contextEnvelope` accepts an optional `cliVersion`, `null` when the envelope is built outside the CLI.

* `QuerySelectionError` gains the reason `browse-needs-terminal`, used when `okfit query browse` runs without a terminal (exit 64).

- `okfit validate` and the MCP `validate_bundle` now report a `resource` or `sources[].resource` that exists locally but is gitignored (`resource-ignored`, error) or not yet tracked by git (`resource-untracked`, warning; not raised once the file is staged). A directory is tracked when the index lists a file under it, a path inside a submodule is judged against the submodule's own index, and a bundle outside a git repository is skipped.
- `RunOptions` gains `skipUntracked`. `skipProvenance` implies it, and the language server's `BundleSession` always sets it.

### Bug Fixes

- `okfit sync --staged` resolves repository-relative paths with `relativeWithin` and fails with `ConceptOutsideRepositoryError` for a concept or `log.md` that resolves outside the repository, instead of silently skipping it. Validate and session revalidate carry the new error in their failure unions.

* `okfit sync --staged` in index mode now renders `index.md` from the git index instead of the working tree. An untracked concept, or one removed with `git rm --cached`, is no longer listed in the committed index, directories holding only untracked concepts are dropped, and a tracked concept with unstaged edits renders its indexed title and description (#142).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.13.5 | 0.14.0 |
| @okfit/profiles | dependency | updated | 0.14.7 | 0.15.0 |

## 0.20.7

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | 0.33.0 | 0.34.0 |
| @effected/config-file | dependency | updated | 0.28.0 | 0.29.0 |
| @effected/glob | dependency | updated | 0.22.0 | 0.23.0 |
| @effected/walker | dependency | updated | 0.29.0 | 0.30.0 |
| @effected/xdg | dependency | updated | 0.21.0 | 0.22.0 |
| @okfit/core | dependency | updated | 0.13.4 | 0.13.5 |
| @okfit/profiles | dependency | updated | 0.14.6 | 0.14.7 |

## 0.20.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | 0.33.0 | 0.33.1 |

## 0.20.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | 0.32.1 | 0.33.0 |
| @effected/config-file | dependency | updated | 0.27.1 | 0.28.0 |
| @effected/glob | dependency | updated | 0.21.0 | 0.22.0 |
| @effected/schemastore | dependency | updated | 0.32.0 | 0.33.0 |
| @effected/walker | dependency | updated | 0.28.0 | 0.29.0 |
| @effected/xdg | dependency | updated | 0.20.1 | 0.21.0 |
| @okfit/core | dependency | updated | 0.13.3 | 0.13.4 |
| @okfit/profiles | dependency | updated | 0.14.5 | 0.14.6 |

## 0.20.4

### Build System

- Pins every `effect`, `@effect/*` and `@effected/*` runtime dependency to an exact version instead of a caret. An installed okfit now runs exactly the kit it was tested with: a newer kit patch reaches it only through a new okfit release, and okfit no longer conflicts with a host repository that has moved to a newer Effect or kit release.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.1.3 | 4.1.4 |
| @effected/app | dependency | updated | ^0.32.1 | 0.32.1 |
| @effected/config-file | dependency | updated | ^0.27.1 | 0.27.1 |
| @effected/files | dependency | updated | ^0.3.0 | 0.3.0 |
| @effected/git | dependency | updated | ^0.32.0 | 0.32.0 |
| @effected/glob | dependency | updated | ^0.21.0 | 0.21.0 |
| @effected/jsonc | dependency | updated | ^0.25.0 | 0.25.0 |
| @effected/kit | dependency | updated | ^0.14.0 | 0.14.0 |
| @effected/markdown | dependency | updated | ^0.29.0 | 0.29.0 |
| @effected/schemastore | dependency | updated | ^0.32.0 | 0.32.0 |
| @effected/source | dependency | updated | ^0.5.0 | 0.5.0 |
| @effected/store | dependency | updated | ^0.25.0 | 0.25.0 |
| @effected/toml | dependency | updated | ^0.20.0 | 0.20.0 |
| @effected/walker | dependency | updated | ^0.28.0 | 0.28.0 |
| @effected/xdg | dependency | updated | ^0.20.1 | 0.20.1 |
| @effected/yaml | dependency | updated | ^0.30.0 | 0.30.0 |
| effect | dependency | updated | 4.1.3 | 4.1.4 |

## 0.20.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.32.0 | ^0.32.1 |
| @effected/config-file | dependency | updated | ^0.27.0 | ^0.27.1 |
| @effected/walker | dependency | updated | ^0.27.0 | ^0.28.0 |
| @effected/xdg | dependency | updated | ^0.20.0 | ^0.20.1 |
| @okfit/core | dependency | updated | 0.13.2 | 0.13.3 |
| @okfit/profiles | dependency | updated | 0.14.4 | 0.14.5 |

## 0.20.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ~4.1.2 | 4.1.3 |
| @effected/app | dependency | updated | ^0.31.2 | ^0.32.0 |
| @effected/config-file | dependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/files | dependency | updated | ^0.2.0 | ^0.3.0 |
| @effected/git | dependency | updated | ^0.30.0 | ^0.32.0 |
| @effected/glob | dependency | updated | ^0.20.0 | ^0.21.0 |
| @effected/jsonc | dependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/kit | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/markdown | dependency | updated | ^0.28.0 | ^0.29.0 |
| @effected/schemastore | dependency | updated | ^0.31.0 | ^0.32.0 |
| @effected/source | dependency | updated | ^0.4.0 | ^0.5.0 |
| @effected/store | dependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/toml | dependency | updated | ^0.19.1 | ^0.20.0 |
| @effected/walker | dependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/xdg | dependency | updated | ^0.19.2 | ^0.20.0 |
| @effected/yaml | dependency | updated | ^0.29.0 | ^0.30.0 |
| @okfit/core | dependency | updated | 0.13.1 | 0.13.2 |
| @okfit/profiles | dependency | updated | 0.14.3 | 0.14.4 |
| effect | dependency | updated | ~4.1.2 | 4.1.3 |

[#370][#370]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#370]: https://github.com/spencerbeggs/okfit/pull/370

## 0.20.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.31.1 | ^0.31.2 |
| @effected/config-file | dependency | updated | ^0.25.0 | ^0.26.0 |
| @effected/files | dependency | updated | ^0.1.0 | ^0.2.0 |
| @effected/glob | dependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/markdown | dependency | updated | ^0.27.0 | ^0.28.0 |
| @effected/schemastore | dependency | updated | ^0.30.0 | ^0.31.0 |
| @effected/walker | dependency | updated | ^0.25.1 | ^0.26.0 |
| @effected/xdg | dependency | updated | ^0.19.1 | ^0.19.2 |
| @okfit/core | dependency | updated | 0.13.0 | 0.13.1 |
| @okfit/profiles | dependency | updated | 0.14.2 | 0.14.3 |

[#367][#367]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#367]: https://github.com/spencerbeggs/okfit/pull/367

## 0.20.0

### Breaking Changes

- `okfit sync`, `okfit verify` and `okfit mv` now refuse a concept file without write permission and leave it untouched. They used to replace a read-only file anyway, because the write went through a temp file and a rename.

- To keep writing to such a file, restore its write permission with `chmod u+w <file>` first.

### Bug Fixes

- `okfit verify` no longer leaves a stray temp file behind when writing a concept fails partway, and two concurrent runs no longer share one temp file name [#362][#362]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.31.0 | ^0.31.1 |
| @effected/config-file | dependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/glob | dependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/jsonc | dependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/kit | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/markdown | dependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/schemastore | dependency | updated | ^0.29.0 | ^0.30.0 |
| @effected/source | dependency | updated | ^0.3.0 | ^0.4.0 |
| @effected/store | dependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/toml | dependency | updated | ^0.19.0 | ^0.19.1 |
| @effected/walker | dependency | updated | ^0.25.0 | ^0.25.1 |
| @effected/xdg | dependency | updated | ^0.19.0 | ^0.19.1 |
| @effected/yaml | dependency | updated | ^0.28.0 | ^0.29.0 |
| @okfit/core | dependency | updated | 0.12.1 | 0.13.0 |
| @okfit/profiles | dependency | updated | 0.14.1 | 0.14.2 |
| @effected/files | dependency | added | — | ^0.1.0 |

[#362][#362]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#362]: https://github.com/spencerbeggs/okfit/pull/362

## 0.19.1

### Refactoring

- Imports the kit's engine library under its new name, `@effected/kit` (was `@effected/engine`). Exports and behaviour are unchanged. [#357][#357]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/engine | dependency | removed | ^0.11.0 | — |
| @effect/platform-node | dependency | updated | ~4.1.1 | ~4.1.2 |
| @effected/app | dependency | updated | ^0.30.0 | ^0.31.0 |
| @effected/config-file | dependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/git | dependency | updated | ^0.29.0 | ^0.30.0 |
| @effected/glob | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/jsonc | dependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/markdown | dependency | updated | ^0.25.0 | ^0.26.0 |
| @effected/schemastore | dependency | updated | ^0.28.0 | ^0.29.0 |
| @effected/source | dependency | updated | ^0.2.0 | ^0.3.0 |
| @effected/store | dependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/toml | dependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/walker | dependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/xdg | dependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/yaml | dependency | updated | ^0.27.0 | ^0.28.0 |
| @okfit/core | dependency | updated | 0.12.0 | 0.12.1 |
| @okfit/profiles | dependency | updated | 0.14.0 | 0.14.1 |
| effect | dependency | updated | ~4.1.1 | ~4.1.2 |
| @effected/kit | dependency | added | — | ^0.12.0 |

[#357][#357]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#357]: https://github.com/spencerbeggs/okfit/pull/357

## 0.19.0

### Breaking Changes

- `run`, `runSync`, the move, trust and validate programs, and `BundleSessionServices` now require `Digest.Digest` (from `effect/crypto`) instead of `Crypto.Crypto`, which Effect 4.1 removed. `OkfitPlatform` now provides `Digest` itself (via `NodeCrypto.layerDigest`), because `NodeServices.layer` no longer carries crypto. If you compose your own layers rather than using `OkfitPlatform`, add `NodeCrypto.layerDigest` from `@effect/platform-node`. Digests are byte-identical to before.

### Bug Fixes

- The overlay filesystem (`makeOverlayFileSystem` / `layerOverlayFileSystem`) now shadows Effect 4.1's `readDirectoryEntries`, so unsaved open documents are listed as `File` entries in directory reads.
- `changeSince` (the `okfit verify` change preview) reads its patch through `@effected/git`'s `Git.diffFile`, which pins colour, prefixes, context and algorithm, so user diff config no longer changes the preview. It no longer requires `ChildProcessSpawner`; every diff failure still surfaces as `GitCommandError`.
- `planMove` places a destination through `@effected/walker`'s `relativeWithin`. A destination whose containment cannot be proved (for example a permission error while resolving it) is now refused as `outside-bundle` instead of being resolved lexically.
- `okfit verify` refuses a concept whose content cannot be hashed (a frontmatter value holding an unpaired surrogate) with the new `VerifyContentUnhashableError` (exit 3), naming the field. Nothing is written. [#354][#354]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.7 | ~4.1.1 |
| @effected/app | dependency | updated | ^0.29.0 | ^0.30.0 |
| @effected/config-file | dependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/engine | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/git | dependency | updated | ^0.27.0 | ^0.29.0 |
| @effected/glob | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/jsonc | dependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/markdown | dependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/schemastore | dependency | updated | ^0.27.0 | ^0.28.0 |
| @effected/source | dependency | updated | ^0.1.0 | ^0.2.0 |
| @effected/store | dependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/toml | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/walker | dependency | updated | ^0.22.0 | ^0.24.0 |
| @effected/xdg | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/yaml | dependency | updated | ^0.26.0 | ^0.27.0 |
| @okfit/core | dependency | updated | 0.11.8 | 0.12.0 |
| @okfit/profiles | dependency | updated | 0.13.0 | 0.14.0 |
| effect | dependency | updated | ^4.0.7 | ~4.1.1 |

[#354][#354]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#354]: https://github.com/spencerbeggs/okfit/pull/354

## 0.18.2

### Bug Fixes

- `okfit sync --staged` finds a repository defined only by `GIT_DIR` and `GIT_WORK_TREE`, with no `.git` on disk, by retrying with that environment honoured when the hook-safe lookup finds none.
- Error text renders through `ErrorText.describe`: a non-`Error` value without a `message` now appears as JSON rather than `[object Object]`.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.6 | ^4.0.7 |
| @effected/app | dependency | updated | ^0.28.0 | ^0.29.0 |
| @effected/config-file | dependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/engine | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/git | dependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/glob | dependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/jsonc | dependency | updated | ^0.20.1 | ^0.21.0 |
| @effected/markdown | dependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/schemastore | dependency | updated | ^0.26.3 | ^0.27.0 |
| @effected/store | dependency | updated | ^0.20.0 | ^0.21.0 |
| @effected/toml | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/walker | dependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/xdg | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/yaml | dependency | updated | ^0.25.1 | ^0.26.0 |
| @okfit/core | dependency | updated | 0.11.7 | 0.11.8 |
| @okfit/profiles | dependency | updated | 0.12.0 | 0.13.0 |
| effect | dependency | updated | ^4.0.6 | ^4.0.7 |
| @effected/source | dependency | added | — | ^0.1.0 |

[#339][#339]

### Maintenance

- `okfit sync --staged` resolves the repository root with `@effected/git`'s hook-safe `repoRoot` in place of its own worktree walk. [#339][#339]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#339]: https://github.com/spencerbeggs/okfit/pull/339

## 0.18.1

### Bug Fixes

- The editor overlay (`layerOverlayFileSystem`, used by the language server and by `okfit validate --document`) now answers `lstat` for an open document as well as `stat`. `@effected/walker` 0.21 `lstat`s every entry it walks and skips one that is not found, so a new, unsaved concept was left out of the bundle and got no diagnostics until it was saved. [#334][#334]

* The interactive `okfit verify` picker now offers every drifted concept, whatever its type, alongside the unattested concepts of `require_verified` types. Before, a drifted Interface, Module or other non-required type got a `verified-drift` warning telling you to re-run `okfit verify`, but the picker never listed it. A concept of such a type that nobody has verified is still left out.
* `okfit verify --all` takes the same drifted concepts of any type. With `--type`, it still takes exactly the named types. [#334][#334]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.27.1 | ^0.28.0 |
| @effected/config-file | dependency | updated | ^0.20.1 | ^0.21.0 |
| @effected/engine | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/git | dependency | updated | ^0.25.1 | ^0.26.0 |
| @effected/glob | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/jsonc | dependency | updated | ^0.20.0 | ^0.20.1 |
| @effected/schemastore | dependency | updated | ^0.26.2 | ^0.26.3 |
| @effected/store | dependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/walker | dependency | updated | ^0.20.1 | ^0.21.0 |
| @effected/xdg | dependency | updated | ^0.15.1 | ^0.16.0 |
| @okfit/core | dependency | updated | 0.11.6 | 0.11.7 |
| @okfit/profiles | dependency | updated | 0.11.0 | 0.12.0 |

[#334][#334]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#334]: https://github.com/spencerbeggs/okfit/pull/334

## 0.18.0

### Features

- The engine now re-exports the `AppDirs`, `Xdg` and `XdgEnvError` types from `@effected/xdg`. These are the services and the failure `OkfitPlatform` brings in. A front end whose commands require them can now name them through `@okfit/engine`. Before, TypeScript 7.1 rejected the inferred types of those commands with TS2883 ("cannot be named without a reference to ..."). Nothing changes at runtime. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.27.0 | ^0.27.1 |
| @effected/config-file | dependency | updated | ^0.20.0 | ^0.20.1 |
| @effected/git | dependency | updated | ^0.25.0 | ^0.25.1 |
| @effected/walker | dependency | updated | ^0.20.0 | ^0.20.1 |
| @effected/xdg | dependency | updated | ^0.15.0 | ^0.15.1 |

[#322][#322]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/okfit/pull/322

## 0.17.0

### Breaking Changes

- Removed `SyncStagedLogError`: `runSync` with `staged` now runs log mode instead of refusing it. Drop any `catchTag("SyncStagedLogError")` branch; there is nothing left to catch.

### Features

#### Staged log entries

- `runSync({ staged })` with log mode selected writes the commit's own `log.md` entry for each staged concept and re-adds `log.md` to the index, so a pre-commit hook no longer leaves the log one commit behind.

- The group date is the `staged.at` instant; the verb is `Added` for a path `HEAD` lacks and `Updated` otherwise

- Re-running for an amend, or a later ordinary sync, leaves the log `unchanged`

- A `log.md` with unstaged edits is skipped with reason `dirty` instead of being staged

### Bug Fixes

- `runSync({ staged })` from a linked worktree's pre-commit hook no longer stages a sub-directory index at a repo-root path (`decisions/index.md`) or misses the staged concepts; the repository root no longer comes from `git rev-parse --show-toplevel`, which names the bundle root when `GIT_DIR` is exported
- `runSync({ staged })` re-adds `index.md` and `log.md` at their real paths, like the concepts it re-adds, when the bundle root is reached through a symlink or the file is itself one [#320][#320]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.26.0 | ^0.27.0 |
| @effected/config-file | dependency | updated | ^0.19.1 | ^0.20.0 |
| @effected/markdown | dependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/schemastore | dependency | updated | ^0.26.1 | ^0.26.2 |
| @effected/store | dependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/walker | dependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/xdg | dependency | updated | ^0.14.1 | ^0.15.0 |
| @effected/yaml | dependency | updated | ^0.25.0 | ^0.25.1 |
| @okfit/core | dependency | updated | 0.11.5 | 0.11.6 |
| @okfit/profiles | dependency | updated | 0.10.6 | 0.11.0 |

[#320][#320]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#320]: https://github.com/spencerbeggs/okfit/pull/320

## 0.16.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.25.0 | ^0.26.0 |
| @effected/config-file | dependency | updated | ^0.18.0 | ^0.19.1 |
| @effected/git | dependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/jsonc | dependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/markdown | dependency | updated | ^0.20.0 | ^0.22.0 |
| @effected/schemastore | dependency | updated | ^0.25.0 | ^0.26.1 |
| @effected/store | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/toml | dependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/xdg | dependency | updated | ^0.13.0 | ^0.14.1 |
| @effected/yaml | dependency | updated | ^0.23.0 | ^0.25.0 |
| @okfit/core | dependency | updated | 0.11.4 | 0.11.5 |
| @okfit/profiles | dependency | updated | 0.10.5 | 0.10.6 |

[#316][#316]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#316]: https://github.com/spencerbeggs/okfit/pull/316

## 0.16.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.5 | ^4.0.6 |
| @effected/app | dependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/config-file | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/engine | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/git | dependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/glob | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/jsonc | dependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/markdown | dependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/schemastore | dependency | updated | ^0.24.0 | ^0.25.0 |
| @effected/store | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/toml | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/walker | dependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/xdg | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/yaml | dependency | updated | ^0.22.0 | ^0.23.0 |
| @okfit/core | dependency | updated | 0.11.3 | 0.11.4 |
| @okfit/profiles | dependency | updated | 0.10.4 | 0.10.5 |
| effect | dependency | updated | ^4.0.5 | ^4.0.6 |

[#310][#310]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#310]: https://github.com/spencerbeggs/okfit/pull/310

## 0.16.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | ^0.18.0 | ^0.19.0 |
| @okfit/core | dependency | updated | 0.11.2 | 0.11.3 |
| @okfit/profiles | dependency | updated | 0.10.3 | 0.10.4 |

[#303][#303]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#303]: https://github.com/spencerbeggs/okfit/pull/303

## 0.16.2

### Bug Fixes

- The overlay filesystem's `stat` for an unsaved editor buffer reports `dev` as a `bigint`, matching `FileSystem.File.Info` in effect 4.0.5. [#300][#300]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.4 | ^4.0.5 |
| @effected/app | dependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/config-file | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/engine | dependency | updated | ^0.6.0 | ^0.7.0 |
| @effected/git | dependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/glob | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/jsonc | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/markdown | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/schemastore | dependency | updated | ^0.23.0 | ^0.24.0 |
| @effected/store | dependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/toml | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/walker | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/xdg | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/yaml | dependency | updated | ^0.21.0 | ^0.22.0 |
| @okfit/core | dependency | updated | 0.11.1 | 0.11.2 |
| @okfit/profiles | dependency | updated | 0.10.2 | 0.10.3 |
| effect | dependency | updated | ^4.0.4 | ^4.0.5 |

[#300][#300]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#300]: https://github.com/spencerbeggs/okfit/pull/300

## 0.16.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.3 | ^4.0.4 |
| @effected/app | dependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/config-file | dependency | updated | ^0.15.0 | ^0.16.0 |
| @effected/engine | dependency | updated | ^0.5.0 | ^0.6.0 |
| @effected/git | dependency | updated | ^0.21.0 | ^0.22.0 |
| @effected/glob | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/jsonc | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/markdown | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/schemastore | dependency | updated | ^0.22.0 | ^0.23.0 |
| @effected/store | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/toml | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/walker | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/xdg | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/yaml | dependency | updated | ^0.20.0 | ^0.21.0 |
| @okfit/core | dependency | updated | 0.11.0 | 0.11.1 |
| @okfit/profiles | dependency | updated | 0.10.1 | 0.10.2 |
| effect | dependency | updated | ^4.0.3 | ^4.0.4 |

[#292][#292]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#292]: https://github.com/spencerbeggs/okfit/pull/292

## 0.16.0

### Features

#### Concept targets

- `Targets.resolve(args, bundle, cwd)` resolves any mix of absolute paths, cwd-relative paths and concept ids to concepts, all or nothing. A failure lists every bad argument, with a nearest-id suggestion where one exists, as one `TargetResolutionError` (exit 64). Pass `{ files: true }` to accept any bundle file, such as `index.md`.
- `runRevokeIds` revokes several concepts all or nothing.

#### Moving a concept

- `planMove`/`runMove` move a concept and rewrite every reference to it across the bundle, keeping each reference's spelling. Nothing is written unless every reference can be rewritten.
- `okfit mv` refuses to move the bundle's root project file (`MoveError` reason `project-file`) and refuses a destination that reaches outside the bundle through a symlinked directory.

### Bug Fixes

#### Sync and nested directories

- `okfit sync` now writes the missing `index.md` of a directory that holds only a nested directory, such as `topics/` after a concept moves to `topics/deep/`, so the link its parent index already carries no longer dangles.

#### Moving a concept

- `planMove` refuses (`MoveError` reason `unloaded-files`) while the bundle holds Markdown that did not load as a concept, since a link to the moved file inside it would be left stale; run `okfit validate` and fix those files first.
- `okfit mv` rebases an angle-bracketed body link whose path holds a space (`[x](<../docs/my file.md>)`) in a moved concept, and refuses rather than write a spaced path outside angle brackets.
- `Targets.resolve` accepts a bundle file whose name begins with two dots, such as `..draft.md`. [#284][#284]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node-shared | dependency | removed | 4.0.2 | — |
| @okfit/core | dependency | updated | 0.10.0 | 0.11.0 |
| @okfit/profiles | dependency | updated | 0.10.0 | 0.10.1 |

[#284][#284]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#284]: https://github.com/spencerbeggs/okfit/pull/284

## 0.15.0

### Breaking Changes

#### JSON envelopes

- `SyncEnvelope` mode results gain a `migrated` id list.
- `PublicationEnvelope.digests[].body_sha256` is renamed to `digests[].body` and now holds a 16-hex digest. A consumer of `okfit sync --publication --format json` must read `body`.
- `VerifyEnvelope` gains an optional `prior_integrity` (`content-changed`, `unbound` or `entry-superseded`), present only when the concept's prior human verification had drifted. The envelope does not report the new binding itself.
- `SkipReason` gains `integrity-unsupported` and `renders-unsupported`; an exhaustive switch over it must handle both.

#### Signatures

- `FrontmatterEdits.verified` and `FrontmatterEdits.verifiedWithStatus` take a required `content` argument, the content digest the new `integrity.verified` binding records.

- `selectAttestable`, `selectPickerCandidates` and `selectStaleCandidates` take a required `signals` map (`Trust.signals` from `@okfit/profiles`), so drifted concepts are offered again.

- Migration: compute the signals once per bundle with `Trust.signals(bundle, now)` and pass them through; compute `content` with `Derivation.contentDigest(concept.frontmatter.raw, source)`.

#### Concept summaries and filters

- `ConceptSummary` gains required `tier`, `integrity` and `stale` fields.
- `toConceptSummary(concept, signal)` now requires the concept's trust signal.
- `ConceptFilter.verified` changes from a boolean to `"current" | "unverified"`: `"current"` matches concepts whose verification still binds the content, `"unverified"` matches concepts never verified. `ConceptFilter` also gains `drifted` and `stale`.
- `ConceptQuery.list` takes a `signals` map.
- `queryGetEnvelope` input requires `drift`, and `QueryGetEnvelope.concept.drift` and `ContextEnvelope.trust` are required keys.
- `BundleSessionShape` gains a required `signals`, and `RunResult.signals` is required.

#### Trust signal on every result

- `RunResult.signals` and `BundleSessionShape.signals()` expose the per-concept trust signals computed for a run
- New `ContextTrust` export for the context trust summary
- New `TrustDrift` type with `toTrustDrift` and `signalFor` to turn a signal into a consumer-facing drift description
- `QueryGetEnvelope.concept.drift` reports why a verified concept drifted
- `ContextEnvelope.trust` carries a trust summary, built by the new `runContextTrust`
- New `loadPreviews` loads the diff previews the verify picker shows for drifted concepts [#280][#280]

* Trust signals honour the \[actors\].humans allow-list
* okfit verify, --revoke and the picker refuse a human that a non-empty \[actors\].humans does not list (HumanActorNotAllowedError, exit 3), and honour git config okfit.actor
* The prior_integrity and drift reason enums include actor-not-allowed [#281][#281]

#### Verify picker

- `PickerCandidate` gains `path` and `boundAt`. `path` is bundle-relative from `selectPickerCandidates` and `selectStaleCandidates`, and absolute from `loadPickerCandidates` and `loadStaleCandidates`.

- Migration: compute signals once per bundle (`RunResult.signals` or `BundleSessionShape.signals()`) and pass them to `toConceptSummary` and `ConceptQuery.list`. Replace `verified: true` with `verified: "current"` and `verified: false` with `verified: "unverified"`.

* `runVerify`, `runRevoke`, `runVerifyBatch`, `runVerifyIds`, `loadPickerCandidates` and `loadStaleCandidates` can now fail with `HumanActorNotAllowedError` and `ActorConfigInvalidError`.

### Features

- `okfit sync` stamps `integrity.generated.body` and migrates legacy `generated.body_sha256` and Publication `renders[].body_sha256` digests to the new family, counting migrated concepts
- Verify binds `integrity.verified { by, at, content }` to a digest of the body plus authored frontmatter
- Batch verify and the picker re-offer concepts that drifted since verification
- New exports: `runRevoke` (with `RevokeOptions`, `RevokeResult`), `RevokeEnvelope` and `revokeEnvelope`, `VerifyNothingToRevokeError`, `inspectDrift` (with `DriftInspection`), and `changeSince` (with `ChangeSince`) for the git diff since a concept was last verified [#278][#278]

* Trust signals honour the \[actors\].humans allow-list
* okfit verify, --revoke and the picker refuse a human that a non-empty \[actors\].humans does not list (HumanActorNotAllowedError, exit 3), and honour git config okfit.actor
* The prior_integrity and drift reason enums include actor-not-allowed [#281][#281]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.2 | 4.0.2 |
| @effect/platform-node-shared | dependency | updated | 4.0.2 | ^4.0.3 |
| @effected/app | dependency | updated | ^0.21.3 | ^0.21.3 |
| @effected/config-file | dependency | updated | ^0.14.3 | ^0.14.3 |
| @effected/engine | dependency | updated | ^0.4.1 | ^0.4.1 |
| @effected/git | dependency | updated | ^0.20.1 | ^0.20.1 |
| @effected/glob | dependency | updated | ^0.10.1 | ^0.10.1 |
| @effected/jsonc | dependency | updated | ^0.15.2 | ^0.15.2 |
| @effected/markdown | dependency | updated | ^0.15.2 | ^0.15.2 |
| @effected/schemastore | dependency | updated | ^0.21.5 | ^0.21.5 |
| @effected/store | dependency | updated | ^0.13.2 | ^0.13.2 |
| @effected/toml | dependency | updated | ^0.11.2 | ^0.11.2 |
| @effected/walker | dependency | updated | ^0.15.1 | ^0.15.1 |
| @effected/xdg | dependency | updated | ^0.9.1 | ^0.9.1 |
| @effected/yaml | dependency | updated | ^0.19.2 | ^0.19.2 |
| @okfit/core | dependency | updated | 0.9.2 | 0.10.0 |
| @okfit/profiles | dependency | updated | 0.9.0 | 0.10.0 |
| effect | dependency | updated | 4.0.2 | 4.0.2 |

[#282][#282]

[#277][#277]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#277]: https://github.com/spencerbeggs/okfit/pull/277

[#278]: https://github.com/spencerbeggs/okfit/pull/278

[#280]: https://github.com/spencerbeggs/okfit/pull/280

[#281]: https://github.com/spencerbeggs/okfit/pull/281

[#282]: https://github.com/spencerbeggs/okfit/pull/282

## 0.14.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | ^0.21.3 | ^0.21.4 |

[#273][#273]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#273]: https://github.com/spencerbeggs/okfit/pull/273

## 0.14.0

### Features

- Adds `selectStaleCandidates` and `loadStaleCandidates` for finding the concepts whose `stale_after` has passed, and a `VerifyIdsOptions.refreshStaleAfter` option that rolls `stale_after` forward and overwrites the actor's own `verified[].at` entry when re-attesting.
- Adds `planSync` and `applySyncPlan`, which split sync into a reviewable plan and its application. `runSync` behaves the same from the outside.
- `VerifySelectionError` gains a `dry-run-needs-verify` reason.
- `applySyncPlan` re-reads every target before writing and fails with the new exported `SyncPlanStaleError` if any target changed since `planSync`. The error names the changed files and nothing is written. `PendingWrite` gains an optional `before` field holding the plan-time contents. [#267][#267]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.9.1 | 0.9.2 |
| @okfit/profiles | dependency | updated | 0.9.0 | 0.9.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#267]: https://github.com/spencerbeggs/okfit/pull/267

## 0.13.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | ^0.21.2 | ^0.21.3 |

[#263][#263]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#263]: https://github.com/spencerbeggs/okfit/pull/263

## 0.13.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.1 | ^4.0.2 |
| @effected/schemastore | dependency | updated | ^0.21.1 | ^0.21.2 |
| effect | dependency | updated | ^4.0.1 | ^4.0.2 |

[#261][#261]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#261]: https://github.com/spencerbeggs/okfit/pull/261

## 0.13.0

### Features

- Add `FrontmatterEdits.verifiedWithStatus(source, entry, status)`, which appends a `verified` entry and sets `status` in a single edit set. Both changes land in one atomic edit, even when they insert at the same offset, so editors can verify a concept and mark it stable in one step. [#250][#250]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | ^4.0.0 | ^4.0.1 |
| @effected/app | dependency | updated | ^0.20.0 | ^0.21.2 |
| @effected/config-file | dependency | updated | ^0.14.0 | ^0.14.2 |
| @effected/engine | dependency | updated | ^0.3.0 | ^0.4.0 |
| @effected/jsonc | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/markdown | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/schemastore | dependency | updated | ^0.20.0 | ^0.21.1 |
| @effected/store | dependency | updated | ^0.12.0 | ^0.13.1 |
| @effected/toml | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/yaml | dependency | updated | ^0.19.0 | ^0.19.1 |
| @okfit/core | dependency | updated | 0.9.0 | 0.9.1 |
| @okfit/profiles | dependency | updated | 0.9.0 | 0.9.0 |
| effect | dependency | updated | ^4.0.0 | ^4.0.1 |

[#251][#251]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#250]: https://github.com/spencerbeggs/okfit/pull/250

[#251]: https://github.com/spencerbeggs/okfit/pull/251

## 0.12.0

### Features

- `validate` now runs the publication lints (`publication-drift`, `publication-orphan`), so the CLI, MCP server, and language server report them.
- `validate` also checks each Surface's resource glob and reports `surface-unmatched` when it matches no files. [#237][#237]

* Add `stampPublication`, which re-stamps one Publication's `renders` digests so a re-rendered page stops reporting `publication-drift`. `FrontmatterEdits` gains a `rendersDigests` edit to carry the new digests.
* Add `PublicationNotFoundError`, `NotAPublicationError`, and `SyncPublicationConflictError`; all map to exit code 64.
* The sync JSON envelope gains an optional `publication` member naming the page that was restamped. [#237][#237]

### Bug Fixes

- `okfit sync` now replaces a null-valued `generated` key (`generated:` alone or `generated: ~`) with the full block from `actors.agent`, instead of skipping the concept as `generated-unsupported` while `generated-missing` promised sync would create it. A tagged or anchored null (`!!null`, `&a ~`) is still skipped as unsupported. [#247][#247]

* `validate` now runs the publication lints only under the `software-project` profile, so a repository using `profile = "none"` that declares its own `Publication` type no longer gets them.
* `source-resource-missing` now treats an extglob resource such as `@(.github|docs)` as a pattern, as `surface-unmatched` does, instead of warning that the literal path does not exist.

### Performance

- `okfit sync` now replaces a null-valued `generated` key (`generated:` alone or `generated: ~`) with the full block from `actors.agent`, instead of skipping the concept as `generated-unsupported` while `generated-missing` promised sync would create it. A tagged or anchored null (`!!null`, `&a ~`) is still skipped as unsupported. [#247][#247]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.8.5 | 0.9.0 |
| @okfit/profiles | dependency | updated | 0.8.3 | 0.9.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#237]: https://github.com/spencerbeggs/okfit/pull/237

[#247]: https://github.com/spencerbeggs/okfit/pull/247

## 0.11.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | ^0.18.0 | ^0.20.0 |
| @okfit/core | dependency | updated | 0.8.4 | 0.8.5 |
| @okfit/profiles | dependency | updated | 0.8.3 | 0.8.3 |

[#235][#235]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#235]: https://github.com/spencerbeggs/okfit/pull/235

## 0.11.0

### Features

#### Verify an explicit list of concepts

- `runVerifyIds` verifies a given list of concept ids all-or-nothing: if any id cannot be attested, nothing is written. An optional `promote` flag moves drafts to stable in the same write (closes #214)
- `selectPickerCandidates` and `loadPickerCandidates` expose the concepts an interactive picker can offer, with `PickerCandidate`, `PickerCandidatesOptions` and `VerifyIdsOptions` for front ends

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.118 | ^4.0.0 |
| @effected/app | dependency | updated | ^0.19.1 | ^0.20.0 |
| @effected/config-file | dependency | updated | ^0.13.1 | ^0.14.0 |
| @effected/engine | dependency | updated | ^0.2.0 | ^0.3.0 |
| @effected/git | dependency | updated | ^0.19.0 | ^0.20.0 |
| @effected/glob | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/jsonc | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/markdown | dependency | updated | ^0.14.0 | ^0.15.0 |
| @effected/schemastore | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/store | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/toml | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/walker | dependency | updated | ^0.14.1 | ^0.15.0 |
| @effected/xdg | dependency | updated | ^0.8.2 | ^0.9.0 |
| @effected/yaml | dependency | updated | ^0.18.0 | ^0.19.0 |
| @okfit/core | dependency | updated | 0.8.3 | 0.8.4 |
| @okfit/profiles | dependency | updated | 0.8.2 | 0.8.3 |
| effect | dependency | updated | 4.0.0-rc.118 | ^4.0.0 |

[#225][#225]

### Other

- The `VerifySelectionError` no-selection message now ends "(run in a terminal to pick interactively)" [#225][#225]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#225]: https://github.com/spencerbeggs/okfit/pull/225

## 0.10.0

### Features

#### Verify sets status with the attestation

- `runVerify` takes an optional target status and splices it in the same write as the attestation; `VerifyEnvelope` gains `status: { from, to } | null`
- `selectAttestable` holds the batch selection rules once and now skips `deprecated` concepts, reporting the reason `deprecated` beside `draft` and `already-verified`

#### Concept queries

- `ConceptQuery` (`list`, `get`, `neighbors`) is the shared read-only query layer, with `QueryListEnvelope`, `QueryGetEnvelope` and `QueryNeighborsEnvelope` for front ends to render

### Bug Fixes

- `okfit verify` no longer drops a leading UTF-8 byte-order mark when it writes a concept back [#213][#213]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#213]: https://github.com/spencerbeggs/okfit/pull/213

## 0.9.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/xdg | dependency | updated | ^0.8.1 | ^0.8.2 |

[#209][#209]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#209]: https://github.com/spencerbeggs/okfit/pull/209

## 0.9.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.13.0 | ^0.13.1 |
| @effected/git | dependency | updated | ^0.18.1 | ^0.19.0 |
| @effected/walker | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/xdg | dependency | updated | ^0.8.0 | ^0.8.1 |
| @okfit/core | dependency | updated | 0.8.2 | 0.8.3 |
| @okfit/profiles | dependency | updated | 0.8.1 | 0.8.2 |

[#203][#203]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#203]: https://github.com/spencerbeggs/okfit/pull/203

## 0.9.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | ^0.16.0 | ^0.17.0 |
| @okfit/core | dependency | updated | 0.8.1 | 0.8.2 |
| @okfit/profiles | dependency | updated | 0.8.1 | 0.8.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.9.1

### Bug Fixes

- Declared the `@effected/*` peers that `@okfit/core` and `@okfit/profiles` require, so installs no longer satisfy them from whatever version sits at the consumer root [#196][#196]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
| @effected/app | dependency | updated | ^0.18.0 | ^0.19.0 |
| @effected/config-file | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/engine | dependency | updated | ^0.1.0 | ^0.2.0 |
| @effected/git | dependency | updated | ^0.17.0 | ^0.18.1 |
| @effected/glob | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/jsonc | dependency | updated | ^0.13.0 | ^0.14.0 |
| @effected/markdown | dependency | updated | ^0.12.1 | ^0.14.0 |
| @effected/store | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/toml | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/walker | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/xdg | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/yaml | dependency | updated | ^0.17.0 | ^0.18.0 |
| @okfit/core | dependency | updated | 0.8.0 | 0.8.1 |
| @okfit/profiles | dependency | updated | 0.8.0 | 0.8.1 |
| effect | dependency | updated | 4.0.0-rc.117 | 4.0.0-rc.118 |
| @effected/schemastore | dependency | added | — | ^0.16.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#196]: https://github.com/spencerbeggs/okfit/pull/196

## 0.9.0

### Features

- `FrontmatterEdits` — a public, `Context`-free facade over the `okfit verify` splice machinery: `.status(source, status)` and `.verified(source, entry)` return `MarkdownEdit`s at whole-file offsets into `source` as passed (BOM included), so a caller can apply them directly or map them to editor ranges without adjustment. `.verified` matches `okfit verify`'s own splice byte for byte
- `UnsupportedFrontmatterError` — raised instead of a partial write when a frontmatter shape `FrontmatterEdits` cannot splice safely [#181][#181]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | ^0.12.0 | ^0.12.1 |
| @effected/engine | dependency | added | — | ^0.1.0 |

[#186][#186]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#181]: https://github.com/spencerbeggs/okfit/pull/181

[#186]: https://github.com/spencerbeggs/okfit/pull/186

## 0.8.0

### Features

#### `source-resource-missing` now ranges at the offending value

- `lintResources`'s `source-resource-missing` diagnostic now ranges at the specific `resource` value that couldn't be resolved — the top-level `resource` field or the relevant `sources[i].resource` entry — instead of carrying no range, using `@okfit/core`'s new `DiagnosticRange.forFrontmatterPath`.

#### New `conceptFor` export

```ts
import { conceptFor } from "@okfit/engine";

const concept = conceptFor(bundle, absolutePath);
```

- Looks up the loaded concept at an absolute path already known to sit under `bundle.root`, returning `Option.none()` for a path outside the bundle, a reserved file, a non-markdown file, or one that never decoded into a concept. This is the same lookup `withFallbackRange` already used internally; it's now available to consumers that need to resolve an editor-reported path (a file URI, a hover position) back to its concept, such as `@okfit/lsp`. [#179][#179]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.4 | 0.8.0 |
| @okfit/profiles | dependency | updated | 0.7.5 | 0.8.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#179]: https://github.com/spencerbeggs/okfit/pull/179

## 0.7.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |
| @effected/app | dependency | updated | ^0.17.0 | ^0.18.0 |
| @effected/config-file | dependency | updated | ^0.11.1 | ^0.12.0 |
| @effected/git | dependency | updated | ^0.16.0 | ^0.17.0 |
| @effected/glob | dependency | updated | ^0.7.0 | ^0.8.0 |
| @effected/jsonc | dependency | updated | ^0.12.0 | ^0.13.0 |
| @effected/markdown | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/store | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/toml | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/walker | dependency | updated | ^0.11.0 | ^0.12.0 |
| @effected/xdg | dependency | updated | ^0.6.1 | ^0.7.0 |
| @effected/yaml | dependency | updated | ^0.16.0 | ^0.17.0 |
| @okfit/core | dependency | updated | 0.7.3 | 0.7.4 |
| @okfit/profiles | dependency | updated | 0.7.4 | 0.7.5 |
| effect | dependency | updated | 4.0.0-rc.116 | 4.0.0-rc.117 |

[#173][#173]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#173]: https://github.com/spencerbeggs/okfit/pull/173

## 0.7.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/walker | dependency | updated | ^0.10.0 | ^0.11.0 |
| @effected/xdg | dependency | updated | ^0.6.0 | ^0.6.1 |
| @okfit/core | dependency | updated | 0.7.2 | 0.7.3 |
| @okfit/profiles | dependency | updated | 0.7.4 | 0.7.4 |

[#169][#169]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#169]: https://github.com/spencerbeggs/okfit/pull/169

## 0.7.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effected/app | dependency | updated | ^0.16.3 | ^0.17.0 |
| @effected/config-file | dependency | updated | ^0.10.1 | ^0.11.0 |
| @effected/git | dependency | updated | ^0.15.2 | ^0.16.0 |
| @effected/glob | dependency | updated | ^0.6.1 | ^0.7.0 |
| @effected/jsonc | dependency | updated | ^0.11.1 | ^0.12.0 |
| @effected/markdown | dependency | updated | ^0.10.1 | ^0.11.0 |
| @effected/store | dependency | updated | ^0.8.1 | ^0.9.0 |
| @effected/toml | dependency | updated | ^0.7.1 | ^0.8.0 |
| @effected/walker | dependency | updated | ^0.9.1 | ^0.10.0 |
| @effected/xdg | dependency | updated | ^0.5.3 | ^0.6.0 |
| @effected/yaml | dependency | updated | ^0.15.2 | ^0.16.0 |
| @okfit/core | dependency | updated | 0.7.1 | 0.7.2 |
| @okfit/profiles | dependency | updated | 0.7.3 | 0.7.4 |
| effect | dependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

[#162][#162]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/okfit/pull/162

## 0.7.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.16.2 | ^0.16.3 |
| @effected/config-file | dependency | updated | ^0.10.0 | ^0.10.1 |
| @effected/git | dependency | updated | ^0.15.1 | ^0.15.2 |
| @effected/glob | dependency | updated | ^0.6.0 | ^0.6.1 |
| @effected/jsonc | dependency | updated | ^0.11.0 | ^0.11.1 |
| @effected/markdown | dependency | updated | ^0.10.0 | ^0.10.1 |
| @effected/store | dependency | updated | ^0.8.0 | ^0.8.1 |
| @effected/toml | dependency | updated | ^0.7.0 | ^0.7.1 |
| @effected/walker | dependency | updated | ^0.9.0 | ^0.9.1 |
| @effected/xdg | dependency | updated | ^0.5.2 | ^0.5.3 |
| @effected/yaml | dependency | updated | ^0.15.1 | ^0.15.2 |

[#156][#156]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#156]: https://github.com/spencerbeggs/okfit/pull/156

## 0.7.1

### Bug Fixes

- fixes pnpm v12 clsure issues

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.7.0 | 0.7.1 |
| @okfit/profiles | dependency | updated | 0.7.2 | 0.7.3 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.7.0

### Breaking Changes

- `okfitConfigSchemaHost` and `SCHEMA_DIRECTIVE` are no longer exported; import them from `@okfit/core`, which now owns the config JSON Schema contract. The `schema:build` / `schema:check` scripts moved there too, and `@effected/schemastore` is no longer a dependency of this package. [#139][#139]

### Features

#### Version metadata on every JSON envelope

- Exports `ENGINE_VERSION`, now stamped as `engine_version` on every JSON envelope (`JsonEnvelope`, `JsonErrorEnvelope`, and the graph/stale/sync/verify envelopes) — the value to compare across reports produced by different front ends.
- Exports `Distribution` and `DistributionField`: every envelope also carries `distribution`, `{ name, version }` for the meta-package a bin was installed through (e.g. `@okfit/plugin`), or `null` for a direct install.
- `ContextEnvelope` gains `config_schema_version`, sourced from `@okfit/core`'s `CONFIG_SCHEMA_VERSION`.

#### `sync` creates a missing `generated:` block

- When `actors.agent` is configured, `runSync` now creates a `generated:` block for a concept that has none, attributed to that agent, instead of only reporting it skipped (issue #73). Digest drift is still decided first, before any provenance lookup, so an already-stamped, unchanged concept costs no git call.

#### `sync` walks git only for concepts that need it

- `runSync` no longer derives `Derivation.generatedAt` for every concept up front. It now walks history only for a concept whose recorded digest doesn't match its current body, or that log mode still needs (issue #21). On this repo's own bundle, `okfit sync --dry-run` drops from roughly 1.68s to 0.27s.

- One user-visible reclassification falls out of the digest-first reorder: a dirty (uncommitted) concept whose body digest still matches its recorded `generated.body_sha256` is now reported `unchanged` rather than `skipped: dirty`, since drift is decided before provenance is even looked at.

#### `sync --since` and `sync --staged`

- `SyncOptions` gains two new options:

- `logSince`: an inclusive `YYYY-MM-DD` floor for log mode; concepts committed on or after it are considered (default: the newest date already logged).

- `staged`: stamps only the concepts currently in the git index with a caller-given instant, instead of walking history, and re-adds what was written. Log mode cannot be combined with `staged` — attempting it fails with the new `SyncStagedLogError`.

- Log mode's window is now inclusive of the newest logged day (issue #18): a concept committed on a day that already has a `## YYYY-MM-DD` group is appended into that group instead of being dropped, deduped against the `Added`/`Updated` lines sync itself wrote so re-running over the same window never duplicates. Hand-written prose is never compared.

#### Batch verification: `runVerifyBatch`

- A new `runVerifyBatch` function attests every unverified concept whose type declares `require_verified`, optionally narrowed to specific types, in one pass — pairing with the CLI's new `verify --all`/`--type`. It returns a `VerifyBatchResult` (via the new `VerifyBatchOptions`/`VerifyBatchSkipReason` types) with per-concept written fragments and skip reasons (`"draft"` or `"already-verified"`). `VerifyBatchEnvelope`/`verifyBatchEnvelope` render it for `--format json`.

- The new `VerifySelectionError` is raised for a contradictory or empty verify selection (missing id/`--all`/`--type`, both given, or an unknown `--type`); like other usage errors it exits `64`.

- `SyncStagedLogError` and `VerifySelectionError` both carry `[Runtime.errorExitCode] = 64`, so `render/json.ts`'s `jsonError`/`JsonErrorEnvelope` now surface `exit_code: 64` for them under `--format json` — `JsonErrorEnvelope.exit_code` is `3 | 64`, no longer the literal `3`. [#141][#141]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.6.0 | 0.7.0 |
| @okfit/profiles | dependency | updated | 0.7.1 | 0.7.2 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#139]: https://github.com/spencerbeggs/okfit/pull/139

[#141]: https://github.com/spencerbeggs/okfit/pull/141

## 0.6.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.5.0 | 0.6.0 |
| @okfit/profiles | dependency | updated | 0.7.0 | 0.7.1 |

### Maintenance

- Changes generation and URL of schema to `@okfot/engine` package.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.0

### Features

- `validate` now checks that every `resource` and `sources[].resource` value on a concept resolves to a real file, either relative to the concept's own directory or to the bundle root. URLs, scope descriptions, and glob patterns are recognized as descriptors and skipped, never resolved against the filesystem. This check is controlled by `@okfit/core`'s new `source-resource-missing` lint code and reports nothing when that code is set to `"off"`. [#120][#120]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.16.1 | ^0.16.2 |
| @effected/config-file | dependency | updated | ^0.9.0 | ^0.10.0 |
| @effected/xdg | dependency | updated | ^0.5.1 | ^0.5.2 |
| @okfit/core | dependency | updated | 0.4.1 | 0.5.0 |
| @okfit/profiles | dependency | updated | 0.6.0 | 0.7.0 |

[#121][#121]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#120]: https://github.com/spencerbeggs/okfit/pull/120

[#121]: https://github.com/spencerbeggs/okfit/pull/121

## 0.4.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/profiles | dependency | updated | 0.5.0 | 0.6.0 |

## 0.4.0

### Features

- `okfit lint [path] [--config] [--format human|json] [--skip-provenance]` runs the same engine call as `okfit validate` but drops the conformance tier from what it collects and reports: exit `1` on a lint or profile error, `0` otherwise, never `2`, and its JSON envelope's `summary.conformance_errors` is always `0`.
- `okfit graph [path] [--config] [--format mermaid|dot|json]` renders the bundle's link graph — frontmatter path fields and body links, including dangling links — as a Mermaid flowchart (the default), GraphViz DOT, or a `GraphEnvelope` JSON document. Always exits `0`; loading never fails on content, so a bundle that fails `validate`'s conformance tier still graphs cleanly.
- `okfit stale [path] [--config] [--format human|json]` lists every concept whose `stale_after` instant has passed as of now (honouring `OKFIT_NOW`), sorted by id, each with how many whole days past it. A report, not a check: always exits `0`, printing a `StaleEnvelope` JSON document under `--format json`. [#93][#93]

* The `okfit validate --format json` envelope (and the MCP `validate_bundle` report, which reuses it) gains a `producer` field naming the package that produced the report: `okfit` from the CLI, `@okfit/mcp` from the MCP server. `okfit_version` was already that package's own version, so the two reports over one bundle legitimately differ there; `producer` labels why. [#91][#91]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @okfit/core | dependency | updated | 0.4.0 | 0.4.1 |
| @okfit/profiles | dependency | updated | 0.4.0 | 0.5.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/okfit/pull/91

[#93]: https://github.com/spencerbeggs/okfit/pull/93

## 0.3.0

### Features

- The context envelope's `types[]` entries now carry `required`, `require_verified`, and `fields` — the constraints `validate` enforces for that type — instead of just `name`, `description`, and `guidance`. New exported schemas `ContextField` and `ContextFieldValue` describe one declared field and its enum values.

### Bug Fixes

- `init` now scaffolds `log.md` with a `# Log` title via `Derive.renderLog` instead of a bare entry, so the file's first line is a heading and passes markdownlint's MD041 in a repo that lints the bundle. [#64][#64]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/app | dependency | updated | ^0.16.0 | ^0.16.1 |
| @effected/config-file | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/git | dependency | updated | ^0.15.0 | ^0.15.1 |
| @effected/walker | dependency | updated | ^0.8.0 | ^0.9.0 |
| @effected/xdg | dependency | updated | ^0.5.0 | ^0.5.1 |
| @effected/yaml | dependency | updated | ^0.15.0 | ^0.15.1 |
| @okfit/core | dependency | updated | 0.3.1 | 0.4.0 |
| @okfit/profiles | dependency | updated | 0.3.1 | 0.4.0 |

[#64][#64]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#64]: https://github.com/spencerbeggs/okfit/pull/64

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
  `Crypto.Crypto`, alongside the existing `FileSystem.FileSystem | Path.Path | Git | GitHistory`. A caller providing `NodeServices.layer`
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
