import { Git } from "@effected/git";
import { relativeWithin } from "@effected/walker";
import type { BundleLoadError, ConceptId, LoadedBundle, OkfitConfig } from "@okfit/core";
import { Bundle, Derive } from "@okfit/core";
import type { BodyProvenance, GeneratedAtError, GitHistory } from "@okfit/profiles";
import { ConceptOutsideRepositoryError, Derivation } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Option, Path, Schema } from "effect";
import type { Digest } from "effect/crypto";
import { changedConceptIds, changedDirectories, changedFiles } from "../changedDuringLoad.js";
import { SyncPlanStaleError } from "../errors.js";
import type { GeneratedProvenance } from "./generated.js";
import { syncGenerated } from "./generated.js";
import { escapesBundle, syncIndex } from "./index.js";
import { keyRenamesFor, recordedBodyForSync } from "./legacyKeys.js";
import type { LogProvenance, SyncLogResult } from "./log.js";
import { logWindow, syncLog, wantsLogEntry } from "./log.js";
import { committedView } from "./staged.js";
import type { PendingWrite } from "./write.js";
import { writeAtomic } from "./write.js";

/** The three families `okfit sync` regenerates (contract §5). @public */
export type SyncMode = "generated" | "index" | "log";

/**
 * S-14: a closed union, not free text. The human renderer maps each member
 * to one fixed sentence (`render/sync.ts#humanSync`); the JSON envelope's
 * `skipped[].reason` is this exact union. `changed-during-read` is the transient one: the file was replaced or
 * removed while sync read it, so it was not rewritten; running sync again reads it afresh. It never means the file
 * leaves the bundle (that is `symlink-escape`).
 *
 * @public
 */
export const SkipReason = Schema.Literals([
	"untracked",
	"dirty",
	"unborn",
	"generated-missing",
	"generated-unsupported",
	"integrity-unsupported",
	"renders-unsupported",
	"log-unparseable",
	"index-unparseable",
	"symlink-escape",
	"changed-during-read",
	"legacy-key-conflict",
	"legacy-key-unsupported",
	"verified-after-now",
]);
/** @public */
export type SkipReason = typeof SkipReason.Type;

/** @public */
export interface SyncOptions {
	/** Absolute bundle root, from `resolveProjectConfig`. */
	readonly bundleRoot: string;
	/** Already merged `DEFAULTS < profile < file` by the caller (D-28). `actors.agent`, when set, is threaded into `syncGenerated` (issue #73) so a concept with no `generated` block gets one created; `sync` never calls `profile.check`. */
	readonly config: OkfitConfig;
	/** Members to actually RUN. Absent members still appear in {@link SyncResult}, `selected: false`. */
	readonly modes: ReadonlySet<SyncMode>;
	readonly dryRun: boolean;
	/** Issue #18: log mode's inclusive floor (`YYYY-MM-DD`); default is the newest logged date. */
	readonly logSince?: string;
	/** Issue #140: stamp the concepts in the git index with this instant instead of walking history. Issue #295: log mode dates their entries with the same instant. */
	readonly staged?: { readonly at: DateTime.Utc };
	/**
	 * Issue #471: the run's clock. A `generated.at` more than the tolerance (`GENERATED_AT_TOLERANCE`) later than it is re-stamped to it (whole
	 * seconds), unless that would make a verification dated in between count: then the concept is skipped
	 * (`verified-after-now`). A changed concept's new stamp is capped at it under the same exception, and a stamp
	 * that stays more than the tolerance ahead for that reason is reported `verified-after-now` on the run that holds
	 * it (the concept is still written, so it may be in both `written` and `skipped`). A changed concept's stamp is
	 * never moved back below a verification: when the new stamp is earlier than the existing `generated.at` and a
	 * verification falls in between, the existing stamp is kept, unless it is more than the tolerance ahead and no
	 * verification is dated between now and it, in which case it moves to now. Absent: none of this applies.
	 */
	readonly now?: DateTime.Utc;
}

/**
 * One concept a mode declined to write. `generatedAt` and `verifiedAt` (encoded timestamps) accompany only
 * `verified-after-now`: the stamp left in place and the earliest verification a re-stamp would have made current.
 *
 * @public
 */
export interface SyncSkip {
	readonly id: string;
	readonly reason: SkipReason;
	readonly generatedAt?: string;
	readonly verifiedAt?: string;
}

/** @public */
export interface SyncModeResult {
	readonly selected: boolean;
	/** Bundle-relative. `generated`'s ids have no `.md`; `index`/`log`'s paths do (design §2). */
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	/**
	 * `generated` mode only: ids whose legacy body digest moved to `x-okfit-integrity.generated.body` or whose legacy
	 * key tokens were renamed; may also be in `written` or `skipped`.
	 */
	readonly migrated: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<SyncSkip>;
}

/** @public */
export interface SyncResult {
	readonly bundleRoot: string;
	readonly dryRun: boolean;
	readonly generated: SyncModeResult;
	readonly index: SyncModeResult;
	readonly log: SyncModeResult;
}

/** A selected-`false` placeholder for a mode `--only` excluded from (contract §5). */
const UNSELECTED: SyncModeResult = { selected: false, written: [], unchanged: [], migrated: [], skipped: [] };

/**
 * What {@link planSync} computed and {@link applySyncPlan} will perform.
 * `result` is the exact dry-run report (`dryRun: true`); `pending` holds the
 * file writes behind it, in the fixed generated, index, log order; `restage`
 * (a `--staged` run only) is the `git add` that follows them.
 *
 * @public
 */
export interface SyncPlan {
	readonly result: SyncResult;
	readonly pending: ReadonlyArray<PendingWrite>;
	readonly restage?: { readonly repoRoot: string; readonly files: ReadonlyArray<string> };
}

/**
 * Contract §5's six-step algorithm, computed without writing: one
 * `Bundle.load`, then a lazy `Derivation.generatedAt` walk shared by the
 * generated and log modes (issue #21) -- computed only for a concept that
 * still needs one, not for every concept -- then the three modes in a FIXED
 * order -- generated, index, log -- regardless of `--only`'s own occurrence
 * order. Every mode runs as a dry run and records its writes in
 * {@link SyncPlan.pending}; no mode reads a file another mode writes (generated
 * reads concept files, index reads `index.md`s, log reads `log.md`), which is
 * what makes the dry-run report exact and the deferred apply safe (design §2).
 * `options.dryRun` is ignored here: a plan never writes.
 *
 * @public
 */
export const planSync: (
	options: SyncOptions,
) => Effect.Effect<
	SyncPlan,
	BundleLoadError | GeneratedAtError,
	Git | GitHistory | FileSystem.FileSystem | Path.Path | Digest.Digest
> = Effect.fn("okfit/sync/planSync")(function* (options: SyncOptions) {
	const bundle: LoadedBundle = yield* Bundle.load({ root: options.bundleRoot });

	// A file that changed under the load (`read-changed`) is missing from `bundle`, so anything rendered from it is
	// silently incomplete: a concept dropped from its directory's index, or an index whose frontmatter was never read.
	// Nothing derived from the affected directories is written (their indexes, and no log); sync again.
	const changedAny = changedFiles(bundle).length > 0;
	// The files this load saw: a file the plan writes that is not among them appeared after it.
	const loadedFiles: ReadonlySet<string> = new Set(bundle.files);
	const heldDirs = changedDirectories(bundle);
	const changedSkips: ReadonlyArray<SyncSkip> = changedConceptIds(bundle).map((id) => ({
		id,
		reason: "changed-during-read" as const,
	}));

	// Step 2 (#21): one Derivation.generatedAt per concept that still needs
	// one, shared by the generated and log modes. A concept whose recorded
	// digest matches its body is `unchanged` to generated mode without any
	// git call (syncGenerated decides that first), and its stamped
	// `generated.at` is the date log mode would derive, so it is walked only
	// when log mode is selected AND the log does not already name it under
	// that date. `--only index` alone spawns no git process at all.
	const walked = new Map<ConceptId, BodyProvenance>();
	let staged: Map<ConceptId, GeneratedProvenance> | undefined;
	let scope: ReadonlySet<ConceptId> | undefined;
	let repoRoot: string | undefined;
	// Final-review F5: the realpath-resolved absolute path per scoped
	// concept, kept from this loop so the `git add` list below can use it
	// directly instead of rebuilding `${bundle.root}/${concept.path}` --
	// which, unlike this realpath, does not survive an in-repo symlink.
	let realPaths: Map<ConceptId, string> | undefined;
	// #295: the staged concepts' log provenance, read from the index rather
	// than history: the stamp instant, and Added for a path HEAD lacks.
	let stagedLog: Map<ConceptId, LogProvenance> | undefined;
	let logDirty = false;
	// #142: index mode under --staged lists the index's concepts, not the working tree's.
	let indexView: LoadedBundle = bundle;
	// The key renames the config licenses, computed once and shared by the walk test and syncGenerated.
	const renames = keyRenamesFor(options.config);

	if (options.staged !== undefined) {
		// Issue #140: the pre-commit shape. Inside a hook, `now` is the commit's
		// author date to within seconds -- the same value a post-commit walk
		// would derive -- and the digest written beside it keeps every later
		// run `unchanged`. No history is walked; only the index is consulted.
		const git = yield* Git;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		// `ignoreRepositoryEnv` keeps a hook's exported GIT_DIR from naming the cwd the top level (#315); the
		// answer is already physical (git resolves symlinks), so it needs no realPath. A repository defined only by
		// that environment (GIT_DIR/GIT_WORK_TREE with no .git on disk) is found by the env-honouring retry.
		repoRoot = yield* git
			.repoRoot(bundle.root, { ignoreRepositoryEnv: true })
			.pipe(Effect.catchTag("NotARepositoryError", () => git.repoRoot(bundle.root)));
		const stagedPaths = new Set(yield* git.stagedChanges(repoRoot));
		const selected = new Set<ConceptId>();
		const provenanceStaged = new Map<ConceptId, GeneratedProvenance>();
		const resolvedPaths = new Map<ConceptId, string>();
		const logProvenance = new Map<ConceptId, LogProvenance>();
		const root = repoRoot;
		const conceptRels = new Map<ConceptId, string>();
		for (const [id, concept] of bundle.concepts) {
			const real = yield* fs.realPath(path.join(bundle.root, concept.path));
			const relOption = yield* relativeWithin(root, real, { missing: "refuse" });
			// #351: a concept that resolves outside the repository is a typed failure, not a silent skip.
			if (Option.isNone(relOption)) return yield* new ConceptOutsideRepositoryError({ file: real, root });
			const rel = relOption.value;
			conceptRels.set(id, rel);
			if (!stagedPaths.has(rel)) continue;
			selected.add(id);
			provenanceStaged.set(id, { _tag: "committed", at: options.staged.at });
			resolvedPaths.set(id, real);
			if (options.modes.has("log")) {
				// An unborn HEAD has no tree to look in: every staged concept is new.
				const inHead = yield* git
					.show(root, "HEAD", rel)
					.pipe(Effect.catchTag("UnknownRefError", () => Effect.succeed(Option.none<string>())));
				logProvenance.set(id, { _tag: "committed", at: options.staged.at, creating: Option.isNone(inHead) });
			}
		}
		if (options.modes.has("log") && !(yield* escapesBundle(bundle, "log.md"))) {
			// Restaging log.md would sweep a human's unstaged edits into the commit.
			const logReal = yield* fs
				.realPath(path.join(bundle.root, "log.md"))
				.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)));
			if (logReal !== undefined) {
				const logRelOption = yield* relativeWithin(root, logReal, { missing: "refuse" });
				if (Option.isNone(logRelOption)) return yield* new ConceptOutsideRepositoryError({ file: logReal, root });
				logDirty = (yield* git.unstagedChanges(root)).includes(logRelOption.value);
			}
		}
		if (options.modes.has("index")) indexView = yield* committedView(bundle, root, conceptRels, stagedPaths);
		staged = provenanceStaged;
		stagedLog = logProvenance;
		scope = selected;
		realPaths = resolvedPaths;
	} else if (options.modes.has("generated") || options.modes.has("log")) {
		const window = logWindow(bundle.logs.get(""), options.logSince);
		for (const [id, concept] of bundle.concepts) {
			const generated = concept.frontmatter.generated;
			const digest = yield* Derivation.bodyDigest(concept.document.source);
			const stampedAt = recordedBodyForSync(concept, renames) === digest ? generated?.at : undefined;
			const wanted =
				stampedAt === undefined ||
				(options.modes.has("log") && wantsLogEntry(window, DateTime.formatIsoDate(stampedAt), Derive.title(concept)));
			if (!wanted) continue;
			const derived = yield* Derivation.generatedAt({ file: `${bundle.root}/${concept.path}` });
			walked.set(id, derived);
		}
	}

	const pending: Array<PendingWrite> = [];
	const generatedResult: SyncModeResult = options.modes.has("generated")
		? {
				selected: true,
				...(yield* syncGenerated(bundle, {
					provenance: staged ?? walked,
					dryRun: true,
					renames,
					pending,
					...(options.now === undefined ? {} : { now: options.now }),
					...(options.config.actors?.agent === undefined ? {} : { agent: options.config.actors.agent }),
					...(scope === undefined ? {} : { scope }),
				})),
			}
		: UNSELECTED;
	const generated: SyncModeResult =
		generatedResult.selected && changedSkips.length > 0
			? { ...generatedResult, skipped: [...generatedResult.skipped, ...changedSkips] }
			: generatedResult;
	const index: SyncModeResult = options.modes.has("index")
		? {
				...(yield* syncIndex(indexView, true, pending, options.config.okf_version, heldDirs, loadedFiles)),
				migrated: [],
			}
		: UNSELECTED;
	const log: SyncModeResult = !options.modes.has("log")
		? UNSELECTED
		: changedAny
			? {
					selected: true,
					written: [],
					unchanged: [],
					migrated: [],
					skipped: [{ id: "log.md", reason: "changed-during-read" }],
				}
			: logDirty
				? {
						...({
							selected: true,
							written: [],
							unchanged: [],
							skipped: [{ id: "log.md", reason: "dirty" }],
						} satisfies SyncLogResult),
						migrated: [],
					}
				: {
						...(yield* syncLog(bundle, stagedLog ?? walked, true, options.logSince, pending, loadedFiles)),
						migrated: [],
					};

	let restage: SyncPlan["restage"];
	if (options.staged !== undefined && repoRoot !== undefined) {
		const path = yield* Path.Path;
		// F5: the realpath map built in the staged-set loop above, filtered to
		// the ids `syncGenerated` would write or migrate -- no cast back to `ConceptId`
		// needed, since these keys were never anything else.
		const writtenIds = new Set([...generated.written, ...generated.migrated]);
		// index.md and log.md get the same realpath treatment, so every staged path
		// shares repoRoot's physical spelling: through the bundle root's real path
		// when the file is new, and through the file's own when it exists, which is
		// where writeAtomic writes a symlinked index.md or log.md.
		const fs = yield* FileSystem.FileSystem;
		const realBundle = yield* fs.realPath(bundle.root);
		const reserved: Array<string> = [];
		for (const relative of [...index.written, ...log.written]) {
			const target = path.join(realBundle, relative);
			reserved.push(
				yield* fs.realPath(target).pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(target))),
			);
		}
		const files = [
			...(realPaths === undefined
				? []
				: Array.from(realPaths.entries())
						.filter(([id]) => writtenIds.has(id))
						.map(([, real]) => real)),
			...reserved,
		];
		if (files.length > 0) restage = { repoRoot, files };
	}

	// Record each target's baseline so applySyncPlan can tell it was edited since. A writer that rendered from the
	// loaded bundle already recorded the text the load read; reading the file again here would take an edit that landed
	// since the load as the baseline and let the apply overwrite it. Only a write with no loaded text (a hand-built
	// bundle, a file the load never saw) is read now.
	const fsForSnapshot = yield* FileSystem.FileSystem;
	const snapshotted: Array<PendingWrite> = [];
	for (const write of pending) {
		if (write.before !== undefined) {
			snapshotted.push(write);
			continue;
		}
		const before = yield* fsForSnapshot
			.readFileString(write.target)
			.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)));
		snapshotted.push({ ...write, before });
	}

	return {
		result: { bundleRoot: options.bundleRoot, dryRun: true, generated, index, log },
		pending: snapshotted,
		...(restage === undefined ? {} : { restage }),
	} satisfies SyncPlan;
});

/**
 * Performs exactly the writes a {@link SyncPlan} recorded (atomically, in plan
 * order), then the `--staged` re-add, and returns the non-dry-run
 * {@link SyncResult}. The bundle is not reloaded: the plan is applied as
 * computed. Before writing anything it re-reads every target and fails
 * {@link SyncPlanStaleError} (writing nothing) if one differs from what
 * {@link planSync} saw, so the run writes exactly the plan it showed.
 *
 * @public
 */
export const applySyncPlan = Effect.fn("okfit/sync/applySyncPlan")(function* (plan: SyncPlan) {
	const fs = yield* FileSystem.FileSystem;
	const changed: Array<string> = [];
	for (const write of plan.pending) {
		if (write.before === undefined) continue;
		const now = yield* fs
			.readFileString(write.target)
			.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)));
		if (now !== write.before) changed.push(write.target);
	}
	if (changed.length > 0) return yield* new SyncPlanStaleError({ paths: changed });
	for (const write of plan.pending) yield* writeAtomic(write.target, write.contents);
	if (plan.restage !== undefined) yield* (yield* Git).add(plan.restage.repoRoot, [...plan.restage.files]);
	return { ...plan.result, dryRun: false } satisfies SyncResult;
});

/**
 * `planSync`, then `applySyncPlan` unless `dryRun`.
 *
 * @public
 */
export const runSync: (
	options: SyncOptions,
) => Effect.Effect<
	SyncResult,
	BundleLoadError | GeneratedAtError | SyncPlanStaleError,
	Git | GitHistory | FileSystem.FileSystem | Path.Path | Digest.Digest
> = Effect.fn("okfit/sync/runSync")(function* (options: SyncOptions) {
	const plan = yield* planSync(options);
	if (options.dryRun) return { ...plan.result, dryRun: true } satisfies SyncResult;
	return yield* applySyncPlan(plan);
});
