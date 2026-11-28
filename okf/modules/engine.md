---
type: Module
title: Engine
description: The shared okfit engine -- platform layer, config discovery, and the validate/verify/sync/init/context programs both the CLI and the MCP server depend on directly.
status: stable
resource: ../../packages/engine
x-okfit-kind: package
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-11-28T00:16:02Z
x-okfit-integrity:
  generated:
    body: 5e3575a324702345
---

# Engine

## Purpose

`@okfit/engine` holds the platform layer, config discovery, and the
validate/verify/sync/init/context programs shared by `@okfit/cli` and
`@okfit/mcp`, plus the JSON envelope contracts both front ends render
(`packages/engine/CLAUDE.md:1-6`). It replaces the arrangement where
`@okfit/cli`'s own barrel was the copy contract `@okfit/mcp` depended on
— see [A shared @okfit/engine package replaces
cli-as-copy-contract](../decisions/engine-front-end-split.md) for why.
`@okfit/mcp` depends on this package directly and no longer depends on
`@okfit/cli` at all.

## The platform layer

`platform.ts`'s `OkfitPlatform` is the one XDG/Node platform layer both
front ends provide wholesale, built around a single
`OKFIT_APP_NAMESPACE` literal (`"okfit"`) that exists exactly once in the
whole codebase. Both `@okfit/cli` and `@okfit/mcp` resolve the same
user-level config directory structurally, because they provide the same
layer, rather than by two independently maintained copies agreeing
(`packages/engine/CLAUDE.md`).

## Config discovery and the five programs

`config/layer.ts#buildConfigLayer` builds the two-branch `AppConfig.layer`
call (`--config <file>` given vs. the upward-walk-plus-XDG chain) that
`okfit-config-schema.md` and `okf/decisions/cli-config-discovery-*.md`
describe from the consumer's side; a config that fails decode surfaces as `malformed config <path>: <key>: <reason>`, naming every failing key and its reason (the layer and `OkfitConfig.read` decode with `errors: "all"`). `validate/run.ts`, `verify/{locate,
splice,run}.ts`, `sync/{generated,index,log,write,run}.ts`, and
`init/scaffold.ts` are the five programs; `render/*.ts` holds the
envelope half of each JSON contract (`ContextEnvelope`, `VerifyEnvelope`,
`SyncEnvelope`, `JsonEnvelope`/`JsonErrorEnvelope`), leaving each front
end's human-readable rendering to render there instead. `version.ts`
exports `ENGINE_VERSION`, the one build-time constant in this package
(`process.env.__PACKAGE_VERSION__`, replaced by the bundler), and every
envelope renderer stamps it as `engine_version` itself rather than taking
it from the caller; the renderers also take an optional `distribution`
the front ends thread through from `main()`. See [The engine version, not
the producer version, is what a report is compared
on](../decisions/comparable-version.md).

`render/distribution.ts`'s `Distribution`/`DistributionField` are now
re-exported from `@effected/kit` rather than declared locally, so
`@okfit/cli`'s `CurrentDistribution` reference and every envelope in this
package agree on one shape -- see [okfit's front ends build on
@effected/{engine,cli,mcp} rather than hand-rolled
equivalents](../decisions/effected-kit-adoption.md).

`validate/run.ts#run` and `sync/run.ts#runSync` both now carry
`Digest.Digest` (`effect/crypto`) in their dependencies, satisfied for
free wherever `OkfitPlatform` already runs -- it merges
`NodeCrypto.layerDigest` beside `NodeServices.layer`, which no longer
carries crypto -- since `@okfit/profiles`'
`Provenance.lint`, `Derivation.bodyDigest` and the `verified-drift` lint
need it. `verify/integrity.ts` locates and splices the top-level
`x-okfit-integrity` block (`locateIntegrity`, `spliceIntegrityVerified`, plus the
`x-okfit-integrity.generated.body` splice sync uses), failing closed on aliases,
merge keys and flow mappings, and its zero-length inserts join
`orderVerifyEdits`/`mergeSameOffset` so edits at one offset merge into one
— two zero-length inserts at one offset are the "overlapping edits" case
`MarkdownEdit.applyAll` treats as a programmer error. Digests that are all
digits or digits-e-digits are written single-quoted. `validate/run.ts`
composes `verified-drift` beside `Provenance.lint` and returns the
per-concept `signals` from `run()`; `BundleSession` caches them on each
revalidate, computing them even when the lint is `off` because the editor
and agent surfaces need them. `ConceptSummary` carries `tier`, `integrity`
`stale` and `staleness` (`fresh`, `stale`, `unknown` or `malformed`), `TrustDrift` holds `reason`, `edited_by` and `edited_at`, and
`ConceptFilter` takes `verified` (`current` or `unverified`), `drifted` and
`stale`, with `signalFor` looking up one concept's signal.
`trust/run.ts#runContextTrust` backs `okfit context --trust`. See [Every okfit digest
lives in one integrity family](../decisions/integrity-family.md).

Every `verified` write (`runVerify`, `runVerifyBatch`, `runVerifyIds`)
also binds `x-okfit-integrity.verified`; the refresh path rewrites the binding in
the same edit. Candidate selection counts an actor as already verified only
when it holds the current binding, and a binding is current only while its
bound entry is a current event by OKF v0.3 §5.3, so batch and the picker re-offer drifted concepts, a concept verified before
its last change included. `stale --verify`'s candidates come from staleness
alone (`selectStaleCandidates` never consults integrity). `runVerify` refuses a write that would not be current: `--at` before
`generated.at`, or a `generated.at` in the future, fails with
`VerifyNotCurrentError` (exit `3`); its `kind` is `blocked` (with `blockedBy`, the earliest verification dated between `now` and the stamp) when `generated.at` is more than five minutes later than the run's `now` and sync would skip the re-stamp, `future` when it is more than five minutes later and sync re-stamps it, `near-future` when it is later by less than that, and absent when `now` is not given or `generated.at` is not later than `now` (only `--at` is early), and the message differs for each. `runVerifyBatch`, `runVerifyIds` and both pickers do not fail on such a concept: `select.ts#notCurrentDetail` (which `runVerify`'s refusal also reads, so the `kind` and `blockedBy` are computed once) skips it with the reason `not-current` and a `notCurrent` detail (`VerifySkip`) (`skipped` of `runVerifyIds` is in the order the ids were given), `loadPickerCandidates` and `loadStaleCandidates` drop the row and return it in `leftOut` as a `VerifySkip` (`id`, `reason`, `notCurrent`), sorted by id, and an id list where every concept is not current writes nothing and succeeds (#470). `verify/revoke.ts` implements
`--revoke`: it removes the current actor's own `verified` entries, clears
`x-okfit-integrity.verified` when it was bound to one of them (and `x-okfit-integrity`
when empty), removes the `verified` key when its list empties, and reports
`removed`, `binding_cleared` and `revoked_by`; it fails with a typed error
when there is nothing to revoke. `verify/diff.ts` builds the git diff from
the last commit at or before the bound `at` to the working tree, and the
verify envelope gains an optional `prior_integrity`.

`runSync` migrates legacy digests: `generated.body_sha256` becomes
`x-okfit-integrity.generated.body` and a Publication's `renders[].body_sha256`
becomes `x-okfit-renders[].body`, both cut to 16 hex. The plan and output report
`migrated`, and the skip reasons gain `integrity-unsupported` and
`renders-unsupported`. Migration never touches `verified` and never writes
`x-okfit-integrity.verified`. The same pass renames the old `integrity` key and the built-in
profile fields to their `x-okfit-` spellings, skipping a concept with both spellings
(`legacy-key-conflict`) or a key it cannot rename in place (`legacy-key-unsupported`); see
[okfit's keys carry the x-okfit- prefix](../decisions/okfit-keys-carry-x-okfit-prefix.md).

`verify/run.ts#runVerifyBatch` attests a whole selection at once --
`--all`, narrowed or replaced by `--type <T>` -- instead of one id at a
time: it collects every concept whose type sets `require_verified`, plus
(with no `--type`) every drifted concept of any type, that the caller does
not hold the current binding on, skips `status: draft` concepts and
ones already verified by the caller, and fails closed (nothing written)
if any selected concept's `verified` shape cannot be spliced safely. An
empty or undeclared-type selection is a typed `VerifySelectionError`
(exit `64`) -- a new usage tier the single-id path has no equivalent of;
an unknown single id is exit `3`, not `64`. `render/*.ts`
gained `VerifyBatchEnvelope` alongside the single-concept
`VerifyEnvelope` for `--format json`. `verify/select.ts#selectAttestable`
holds the selection rules once (skip `draft`, `deprecated`, unknown-status and
already-verified concepts, each with its reason; the batch skip reason for an
unknown status is `unknown-status`), and `runVerify` takes an
optional target status that it splices in the same write as the attestation
through `FrontmatterEdits.status`; the envelope's `status` field reports
`{ from, to }`. Writing a concept back keeps a leading UTF-8 byte-order
mark.

`verify/run.ts#runVerifyIds` is the explicit-id sibling of
`runVerifyBatch` (issue 214): it attests the ids it is given,
skipping an unknown status or a not-current concept (each with its reason) and
writing the rest all-or-nothing, with an optional promote-drafts step that sets `status:
stable` in the same write. `verify/select.ts#selectPickerCandidates` and
`verify/run.ts#loadPickerCandidates` list what the interactive `okfit
verify` picker offers: concepts of a `require_verified` type the caller has
not attested, plus every drifted concept of any type (the `verified-drift`
lint's remedy is `okfit verify`, so the picker must offer what it flags),
drafts included, deprecated and unknown-status concepts excluded; each row carries
its absolute `path` and `boundAt`, and `verify/run.ts#loadPreviews` runs
`changeSince` for the drifted rows (a git failure reads as `no-baseline`).
`PickerCandidate.path` is bundle-relative from `selectPickerCandidates`
and `selectStaleCandidates`, and absolute from `loadPickerCandidates` and
`loadStaleCandidates`. A bare `verify` with no selection is still a `VerifySelectionError` (exit `64`); its message now
ends `(run in a terminal to pick interactively)`.

`verify/select.ts#selectStaleCandidates` and
`verify/run.ts#loadStaleCandidates` list the concepts `okfit stale --verify`
offers (the stale ones; deprecated and unknown-status concepts excluded; a concept whose `stale_after` is malformed is
never stale, so it is never offered). `runVerifyIds` takes a
`refreshStaleAfter` option: each attested concept's `stale_after` is rolled
forward to the attestation instant plus `lifecycle.default_stale_after` in the
same all-or-nothing write, through the shared `verify/locate.ts` and splice
helpers, and a re-attest by the same actor overwrites that actor's own
`verified[].at` rather than appending. See [stale --verify rolls stale_after
forward](../decisions/stale-verify.md).

## Migration report and fixes

`migrate/findings.ts` holds `migrationFindings(bundle, config, target, others?)`, where the optional `others` (default `[]`) are the bundle's non-concept Markdown sources: five codes
(`okf-version-undeclared`, `okf-version-older`, `okf-version-unparsable`,
`root-relative-path`, `computation-locator`), found by resolving each
reference under both fallback rules, in every Markdown file of the bundle that is not a concept; `computation-locator` appears only while
the bundle reads with the legacy locator and the two readings differ, and a bundle with no root index
gets an `okf-version-undeclared` finding for `index.md` with no fix. A root
index whose frontmatter never closes or does not parse gets the same code
with a message that names that cause (`okf_version cannot be read, because
...`) and keeps the fix, which `fix.ts` then refuses with its reason.
`migrate/fix.ts` holds `planMigrationFixes` and `applyMigrationFixes`, which
write the two safe fixes (`okf-version`, `root-relative-path`), refuse the
version fix while a root-only reference remains, while an Attested
Computation would lose its computation, while a Markdown file could not be
read, when `okf_version` cannot be edited in place, when the root index's
opening fence is malformed or its frontmatter does not parse (the run
continues), re-record `x-okfit-integrity.generated.body` for a concept whose
digest matched before the edit, list `drifts` (each edited concept whose
integrity was current before the edit, and each whose `x-okfit-integrity`
block the fix will not edit), and keep a BOM and the file's line endings.
Both read and write the root index, the concepts and the non-concept
Markdown themselves, so they need `FileSystem`, `Path` and `Digest`.
`validate/run.ts#run` takes a `target` and returns the findings as
`migration`; they render as a fourth diagnostic source, `"migrate"`, which
`render/exit.ts` never counts toward the exit code. The JSON envelope gains
`target`, `fixes` (the named `JsonFixes`) and `summary.migration_findings`.
`RunResult.legacyKeys` lists the ids of the concepts that still use okfit's
old key names, over the whole bundle even when a caller narrows the report,
so a front end can point at `okfit sync`; it is advisory and not a finding.
`RunOptions.configPath` names the config file in `config-okf-version-stale`;
`ResolvedProjectConfig.configPath` is the value every front end passes.
An empty `Computation` section is not a `computation-locator` finding.
`init` omits the root `title` and `description` for a bundle that declares
0.2 or earlier (#468). See [Migration to a newer OKF version is a report on
validate, with two safe fixes](../decisions/migration-is-a-report.md).

## Concept queries

`query/ConceptQuery.ts`'s `ConceptQuery` is the one read-only query layer
over a loaded bundle: `list` (filter by type, tag, status, verified),
`get` and `neighbors`, with `render/query.ts` shaping the results into
`QueryListEnvelope`, `QueryGetEnvelope` and `QueryNeighborsEnvelope`. The
MCP tools, `okfit query` and the interactive `okfit verify` picker
all call it, so selection and filtering rules live once -- see [One engine
query layer serves the MCP tools, the CLI and the verify
picker](../decisions/engine-concept-query-layer.md).

`sync/run.ts#runSync` is now `planSync` plus `applySyncPlan`: `planSync`
computes every mode's result and collects the `PendingWrite`s (target path and
rendered contents) instead of writing, and `applySyncPlan` writes exactly that
plan, so the CLI's interactive confirm can show a plan and then apply the same
one. Each `PendingWrite` also carries `before`, the text the bundle load read
from the target (`null` = the load saw no such file, so it must still be absent;
a write with no baseline is read by `planSync` itself); `applySyncPlan` re-reads every target
first and fails `SyncPlanStaleError` (exit `3`, nothing written) if one
changed, so a file edited, or an `index.md` or `log.md` created, between the load and the apply is never overwritten (a `log.md` that appeared after the load is skipped `changed-during-read`, not `log-unparseable`).
`runSync` composes the two and behaves as before.

`sync/run.ts#planSync` walks git lazily now: a concept whose recorded
body digest (`x-okfit-integrity.generated.body`, or a legacy `generated.body_sha256`)
still matches its current body, and that log mode
does not need for its date window, is never read through git at all --
only unstamped concepts, or stamped ones the log window still wants,
pay the git cost. On this bundle `okfit sync --dry-run` dropped from
1.68s to 0.27s. `sync/generated.ts#syncGenerated` is digest-first: a
missing `generated:` block is created from `actors.agent` rather than
reported as an unfixable gap, and `sync/log.ts`'s log mode appends into
the newest logged day (inclusive) instead of only after it, deduping
against the two mechanical spellings `sync` itself writes -- see [okfit
sync's log mode appends into the newest logged day and dedupes on its own
spellings](../decisions/sync-log-days.md), which
supersedes the strictly-after rule. `--since <YYYY-MM-DD>` widens that
floor on request. A `staged` mode (`sync/run.ts`) selects only the git
index, stamps `generated.at` with `now` (truncated to seconds) and
`x-okfit-integrity.generated.body` with the body's digest, writes, and re-adds what
it wrote so the stamp lands in the same commit -- meant for a pre-commit
hook only, never for an ordinary run; see [okfit sync --staged stamps the
git index with now, the one place a wall-clock stamp is
honest](../decisions/sync-staged-stamps.md). In both modes the stamp is
`min(derived instant, binding.at)` when the concept's `x-okfit-integrity.verified`
binds its latest human entry and covers exactly the current content
(`sync/generated.ts#stampInstant`), so an edit, verify, commit sequence keeps
the verification current under OKF v0.3 §5.3; the `[actors].humans`
allow-list does not gate it, and a concept whose body digest is unchanged is
never rewritten, except for a `generated.at` more than five minutes later than the
run's `now`, which `SyncOptions.now` makes sync re-stamp to now (#471). A drifted
concept's stamp is clamped to `now` and is never moved back below the stamp it replaces when a verification falls between the two (the existing stamp stays, the digest is re-recorded, and the hold is reported `verified-after-now`). Sync declines a re-stamp that would make a
verification count, reporting the concept in `skipped` as `verified-after-now` with
the stamp and that verification's date; a clamp that would make one count is not
applied, the derived stamp stands and is reported `verified-after-now` on that run (a changed concept is still written, so it may be in
both `written` and `skipped`), and the lint `generated-at-future` also reports it. A kept stamp more than five minutes ahead that guards
no verification dated after now is re-stamped to now on the same run (#509); a hold within the tolerance is not reported. `syncGenerated` also returns `ahead` (each in-scope concept whose `generated.at`, or whose committed author date when it is drifted, is more than the tolerance past `now`); `planSync` takes it out of the generated mode result and sets the optional `SyncResult.clockBehind` (`now`, `latest`, `concepts`), which `SyncEnvelope` carries as `clock_behind`. Sync keeps a leading byte-order mark and the file's line endings when it
rewrites `index.md` or `log.md`: a rewrite uses the file's first newline
throughout (the rule covers LF and CRLF; a file with no LF is written LF),
and a file that differs from what sync would write only in its line endings
is `unchanged` and keeps its bytes. Staged mode never walks history: its log mode reads the staged concepts' provenance from
the index (the stamp instant; `Added` when `git show HEAD:<path>` finds
nothing) and skips a `log.md` with unstaged edits as `dirty`. It takes the
worktree root from `Git.repoRoot(..., { ignoreRepositoryEnv: true })`, which
drops the `GIT_DIR` a linked worktree's hook exports and would otherwise
make git name the bundle root (#315). A malformed `--since` is a parse-time
usage error from the CLI's own argument parser.

`sync/index.ts#syncIndex` keeps the root index's existing frontmatter: it
passes the loaded root `IndexDocument.frontmatter` to `Derive.renderIndex`,
which re-emits it verbatim, so a declared `title`, `description`, `license`,
extension key or version survives a sync (see [The root index's metadata is
read and kept](../decisions/root-index-metadata-is-kept.md)). `syncIndex`
takes the version to add as an argument: `runSync` passes the config's
`okf_version` when the config sets one, and nothing otherwise, so a root
index that declares no version stays undeclared and the spec constant never
moves a bundle (see [The declared OKF version gates the v0.2
fallbacks](../decisions/declared-okf-version-gates-fallbacks.md)).
`init/scaffold.ts` writes the root index with `okf_version` (the config's, or
the `OKF_SPEC_VERSION` constant), a `title` that is the project directory name
and the fixed `BUNDLE_DESCRIPTION`.

`sync` never reads or writes a root or subdirectory `index.md`, or the root
`log.md`, that is a symbolic link out of the bundle, a dangling link
included: `syncIndex` and `syncLog` return it in `skipped` with the reason
`symlink-escape` (`SkipReason`), in plain, dry-run and `--staged` runs, and
the exit code is unchanged. A file that changed under sync's read
(`ConfinementError` reason `changed`) is skipped as `changed-during-read`
instead, a transient skip, never labelled an escape. A file that changed under
`Bundle.load` (`read-changed`) is missing from the bundle, so `planSync` writes nothing derived from the
affected directories: the changed concept id is listed in `generated.skipped`, and `log.md` in
`log.skipped` (`changed-during-read`). `changedDirectories` holds back the file's directory and every
one above it, and `syncIndex` lists each held directory it would have rendered in `index.skipped`: the
root always, and any other only while `Derive.indexDirectories` still yields it, so a directory whose
only concept was the changed one drops out and its `index.md` is neither listed nor written.
`changedDuringLoad.ts` computes those sets, and `mv` (`MoveError`
`changed-during-read`), the migration fix (every selected finding refused) and the verify batch (a
`changed-during-read` skip) use it too, rather than write something silently incomplete. `syncIndex` likewise never renders over a root
or subdirectory `index.md` whose frontmatter never closes or does not parse
(`frontmatter-unclosed` or `frontmatter-unparseable` on that file): it
returns it in `skipped` with the reason `index-unparseable`, in every run,
with the exit code unchanged (`syncLog` already does the same for `log.md`
with `log-unparseable`). `confinement.ts#escapesBundle` (exported, with its
bundle-free core `escapesRoot`) asks core's load diagnostics first and falls
back to `escapesRoot`, where `confineReal` judges the whole path, so a link at
the file or at any directory above it that leads out, or dangles, counts (a
missing file resolves from its real ancestor, so it is an escape only under
a link that leaves). That check decides a skip and gates a write: a write is
checked before it happens, then made atomically. The reads are confined at the moment of reading instead: sync reads
`index.md` and `log.md` through core's `readConfinedBytes`, which opens the
file, resolves its path and compares the open file's `dev` and `ino` with
`lstat` of the real path. A link at the file itself is refused even when it is
swapped in during the read (skipped as `symlink-escape`, or as
`changed-during-read` when it landed between the resolution and the compare),
and never read. A race through a directory above the file can still win,
because the open and the resolution are separate steps on the path (see
spencerbeggs/okfit#524, which also lists the reads that are still
unconfined). A hard link to a file under the root is a file under the
root (OKF 0.3 section 3.2) and is read. `okfit context` uses `escapesRoot`,
and the MCP `okf://index` and `okf://concept/<id>` resources read confined,
so an escaping root `index.md` is reported absent and never read. `okfit
context` is not a confined read: it only checks. `sync --staged` never stamps a concept file
that is a symlink out of the bundle, because core does not load one, and it
skips an escaping `log.md` instead of failing;
`ConceptOutsideRepositoryError` still covers a concept that resolves outside
the repository (see [A concept outside the repository is a typed
failure](../decisions/concept-outside-repository-is-a-typed-failure.md)).

## Repository resources

`validate/repository.ts` is the one place that decides where a cited
`resource` value lies. `resourceCandidates` lists the absolute paths a value
may name in OKF v0.3 §6 order (a leading `/` names the bundle root; otherwise
the file-relative path, then the bundle root for a bare value only while
`OkfVersion.legacyFallbacks` holds) and classifies each as `bundle` or
`repository`; a candidate outside the project root is dropped, so a value with
no candidate is outside the project and the filesystem is never asked about
it. `locateResource` resolves a candidate with `realPath` and requires the
real path to stay inside the real project or bundle root, so a symlink, or a
symlinked parent, that leads out is `outside` and is never statted, read or
sent to git. `RunOptions.projectRoot` and `BundleSessionOptions.projectRoot`
are required: every front end passes the resolved project root, never the
bundle root. `validate/resources.ts` reports `resource-outside-project`
(`info`) beside `source-resource-missing`; `validate/surfaces.ts` reports it
for a glob whose literal prefix is outside the project; `validate/untracked.ts`
only ever judges a located file. See [Repository resources are classified by
where they resolve](../decisions/repository-resources.md).

## Unknown status and `superseded_by` in the engine

`ConceptSummary` carries `status` as the derived status and `raw_status`,
which `rawStatusOf` fills only for an unknown status (the string as written;
a non-string is its JSON text) and leaves `null` otherwise. `ConceptFilter`
takes `statuses` of `DerivedStatus`, so `unknown` is selectable, and `current`:
draft and stable concepts only, intersected with `statuses`, so `current`
with `statuses: ["deprecated"]` lists nothing. `ConceptQuery.get` returns a
`replacement` (`Graph.replacement`) beside the concept: the first current
concept at the end of a deprecated concept's `superseded_by` chain, or `null`.
`okfit context` does not follow `superseded_by`.

`verify` refuses a concept whose status is unknown: `prepareVerify` fails with
`VerifyStatusUnknownError` (exit `3`) unless the call also sets the status
(`--stable` or `--draft`), because that write repairs the status; the check
runs before the drift diff and the confirm prompt. `runVerifyIds` does not
refuse: it skips such an id as `unknown-status` (carrying the raw `status`,
checked before `not-current`) and verifies the rest, and never writes the
skipped file (#507). `VerifyResult.status.from` is the raw string or `null`. See
[An unknown status is not current knowledge](../decisions/unknown-status-is-not-current.md).

`move/references.ts` lists the path-valued frontmatter fields `okfit mv`
rewrites from a `CORE_FIELDS` table keyed on core's `PathField`, so a new core
path field is a type error here until it is handled: `resource`,
`sources[].resource` (a single mapping included), `computation`,
`executor.resource`, `attester.resource` and `superseded_by`. They are read at
the top level of the frontmatter (there is no `attested` key). `move/run.ts`
runs on a bundle that holds `.md` files that are not concepts: a file with no
frontmatter or no `type` is parsed through `Bundle.parseDocument` (the parse
the loader uses) and scanned like a concept body, its links and its core path
fields rewritten, and it appears in the plan's edits only when it changes. A
file with an unclosed or unparseable frontmatter block still refuses with
`MoveError` `unloaded-files`. `mv` writes a rewritten file back with the
leading UTF-8 byte-order mark it had (`bomOf`), and re-records a concept's body
digest (`rerecordBodyDigest`) only when it matched the body before the move, so the next `sync` keeps
`generated.at`; a stale or absent digest and a concept on old key names are not re-recorded (once the move is
committed, the next `sync` re-stamps them, or reports a concept it cannot edit: both key spellings, an old key it cannot rename in place, or an
uneditable integrity layout; `mv` also lists a concept whose `x-okfit-integrity` block has such a layout in `drifts`
when its digest matched before the move).

## Editor seams

`overlay/layer.ts` shadows the ambient `FileSystem` with open editor
buffers (`OverlayDocuments`, absolute path to text and version), falling
through to disk for everything else and listing overlay-only files in
their parent directory (through both `readDirectory` and Effect 4.1's
`readDirectoryEntries`, which reports them as `"File"`) so an unsaved new
concept is walked. It also serves an open document's text through a
read-only `open` and a `realPath` (its real parent directory plus its name),
and answers a not-found `stat`/`lstat` of that real path, so a confined read
sees the buffer; an overlay-only document, which has no inode, reports an
`ino` derived from its path so the identity compare holds. It answers
`lstat` as well as `stat` for them: `@effected/walker` `lstat`s every
entry it descends into, and drops one whose `lstat` is not found.
`overlay/documents.ts#provideDocuments` is the one entry point the CLI's
`validate --document` and the MCP `validate_bundle` `documents` input
share; `DocumentPathError` (exit `64`) owns the path rules.
`session/BundleSession.ts` holds one bundle root's overlay, last bundle,
graph and per-file diagnostics, and its `revalidate({ now, tier })`
re-runs `validate/run.ts#run` under the overlay and returns only the
files whose diagnostics changed, including files not open, and `RevalidateResult.current`, every file's current set, so a publisher can resend a URI's whole set when two keys share it; `tier: "edit"`
skips the git tier. Debounce is the caller's: the language server
schedules, the session serializes overlapping calls. A range-less
finding is anchored on the concept's frontmatter block
(`session/range.ts#withFallbackRange`), which now calls the public
`session/concept.ts#conceptFor(bundle, absolutePath)` helper to resolve
the concept a fallback range belongs to. `validate/resources.ts`'s
`source-resource-missing` lint anchors at the offending `resource` /
`sources[i].resource` value itself, through
[Core](core.md)'s `DiagnosticRange.forFrontmatterPath`, rather than the
frontmatter block. `validate/run.ts#run` also appends
`Publications.lint` (`publication-drift`, `publication-orphan`), only under
the `software-project` profile, and
`validate/surfaces.ts#lintSurfaces` (`surface-unmatched`: a Surface's glob
`resource` matching nothing, warned and ranged at the `resource` value; a
literal `resource` stays `source-resource-missing`'s). `validate/untracked.ts#lintUntrackedResources`
raises `resource-ignored` and `resource-untracked` for literal resources that exist
but that git ignores or does not track (batched per repository, submodules resolved
against their own index); `run` skips it under `skipProvenance` or `skipUntracked`,
and `BundleSession` always skips it. The `lintSurfaces`
walk is breadth-first and depth-bounded to what the glob can match
(unbounded only under `**`); it skips `node_modules` and dot-directories
unless the pattern names them (including through braces, classes and
extglobs) and never descends into symlinked directories. `external/ExternalReferences.ts`
ships only `layerNoop` until the HTTP layer lands.

## Frontmatter edits

`edits/FrontmatterEdits.ts`'s `FrontmatterEdits` is a `Context`-free public
facade over `verify/locate.ts` and `verify/splice.ts`: `.status(source,
status)`, `.verified(source, entry)` and `.verifiedWithStatus(source, entry,
status)` each return `MarkdownEdit`s at
whole-file offsets into `source` as passed, BOM included, so a caller can
apply them with `MarkdownEdit.applyAll` or map them to editor ranges
without adjustment. `.verified` reuses the exact `locate`/`splice`/
`documentNewline` calls `okfit verify`'s `prepareVerify` makes, so its
output matches `okfit verify`'s splice byte for byte; `.status` applies the
same newline rule over `locateTopLevelScalar`/`spliceTopLevelScalar`
instead. `.verifiedWithStatus` is the combined write behind `okfit verify
--stable`: it appends the entry and sets `status`, making no status edit
when the scalar already equals it, and shares `verify/splice.ts`'s internal
`orderVerifyEdits` (status first on an equal-offset merge) with
`prepareVerify`. It always locates `status`, so an unsupported `status`
shape fails even when the value already matches, unlike the CLI, which reads
the parsed status. A shape neither locator recognises fails closed with
`UnsupportedFrontmatterError`, never a partial write. `@okfit/lsp`'s code
actions and commands are the first caller besides `okfit verify` itself --
see [Frontmatter splices are a shared engine surface for the CLI's verify
and the language server's
actions](../decisions/frontmatter-edits.md), which
supersedes the CLI-private splice decision.

## Process boundary

`__test__/boundaries.test.ts` enforces that NO file under `engine/src`
reads `process`, with `version.ts` the single allowlisted exception
(its read is a build-time constant, not a runtime one) — a stricter rule than either
front end's own boundary test carries, because this package is a library
both a CLI and an MCP server import: a `process` read here would bake a
runtime environment read into whichever front end imports it first
(`packages/engine/CLAUDE.md`).
