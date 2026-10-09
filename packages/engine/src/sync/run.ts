import { Git } from "@effected/git";
import type { BundleLoadError, ConceptId, LoadedBundle, OkfitConfig } from "@okfit/core";
import { Bundle, Derive } from "@okfit/core";
import type { BodyProvenance, GeneratedAtError, GitHistory } from "@okfit/profiles";
import { Derivation } from "@okfit/profiles";
import type { Crypto } from "effect";
import { DateTime, Effect, FileSystem, Path, Schema } from "effect";
import { SyncPlanStaleError, SyncStagedLogError } from "../errors.js";
import type { GeneratedProvenance } from "./generated.js";
import { syncGenerated } from "./generated.js";
import { syncIndex } from "./index.js";
import { logWindow, syncLog, wantsLogEntry } from "./log.js";
import type { PendingWrite } from "./write.js";
import { writeAtomic } from "./write.js";

/** The three families `okfit sync` regenerates (contract §5). @public */
export type SyncMode = "generated" | "index" | "log";

/**
 * S-14: a closed union, not free text. The human renderer maps each member
 * to one fixed sentence (`render/sync.ts#humanSync`); the JSON envelope's
 * `skipped[].reason` is this exact union.
 *
 * @public
 */
export const SkipReason = Schema.Literals([
	"untracked",
	"dirty",
	"unborn",
	"generated-missing",
	"generated-unsupported",
	"log-unparseable",
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
	/** Issue #140: stamp the concepts in the git index with this instant instead of walking history; log mode must not be selected. */
	readonly staged?: { readonly at: DateTime.Utc };
}

/** @public */
export interface SyncModeResult {
	readonly selected: boolean;
	/** Bundle-relative. `generated`'s ids have no `.md`; `index`/`log`'s paths do (design §2). */
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: SkipReason }>;
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
const UNSELECTED: SyncModeResult = { selected: false, written: [], unchanged: [], skipped: [] };

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
	BundleLoadError | GeneratedAtError | SyncStagedLogError,
	Git | GitHistory | FileSystem.FileSystem | Path.Path | Crypto.Crypto
> = Effect.fn("okfit/sync/planSync")(function* (options: SyncOptions) {
	const bundle: LoadedBundle = yield* Bundle.load({ root: options.bundleRoot });

	if (options.staged !== undefined && options.modes.has("log")) {
		return yield* new SyncStagedLogError({});
	}

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

	if (options.staged !== undefined) {
		// Issue #140: the pre-commit shape. Inside a hook, `now` is the commit's
		// author date to within seconds -- the same value a post-commit walk
		// would derive -- and the digest written beside it keeps every later
		// run `unchanged`. No history is walked; only the index is consulted.
		const git = yield* Git;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		repoRoot = yield* fs.realPath(yield* git.repoRoot(bundle.root));
		const stagedPaths = new Set(yield* git.stagedChanges(repoRoot));
		const selected = new Set<ConceptId>();
		const provenanceStaged = new Map<ConceptId, GeneratedProvenance>();
		const resolvedPaths = new Map<ConceptId, string>();
		for (const [id, concept] of bundle.concepts) {
			const real = yield* fs.realPath(path.join(bundle.root, concept.path));
			const rel = path.relative(repoRoot, real).split(path.sep).join("/");
			if (!stagedPaths.has(rel)) continue;
			selected.add(id);
			provenanceStaged.set(id, { _tag: "committed", at: options.staged.at });
			resolvedPaths.set(id, real);
		}
		staged = provenanceStaged;
		scope = selected;
		realPaths = resolvedPaths;
	} else if (options.modes.has("generated") || options.modes.has("log")) {
		const window = logWindow(bundle.logs.get(""), options.logSince);
		for (const [id, concept] of bundle.concepts) {
			const generated = concept.frontmatter.generated;
			const digest = yield* Derivation.bodyDigest(concept.document.source);
			const stampedAt =
				generated?.body_sha256 !== undefined && generated.body_sha256 === digest ? generated.at : undefined;
			const wanted =
				stampedAt === undefined ||
				(options.modes.has("log") && wantsLogEntry(window, DateTime.formatIsoDate(stampedAt), Derive.title(concept)));
			if (!wanted) continue;
			const derived = yield* Derivation.generatedAt({ file: `${bundle.root}/${concept.path}` });
			walked.set(id, derived);
		}
	}

	const pending: Array<PendingWrite> = [];
	const generated: SyncModeResult = options.modes.has("generated")
		? {
				selected: true,
				...(yield* syncGenerated(bundle, {
					provenance: staged ?? walked,
					dryRun: true,
					pending,
					...(options.config.actors?.agent === undefined ? {} : { agent: options.config.actors.agent }),
					...(scope === undefined ? {} : { scope }),
				})),
			}
		: UNSELECTED;
	const index: SyncModeResult = options.modes.has("index") ? yield* syncIndex(bundle, true, pending) : UNSELECTED;
	const log: SyncModeResult = options.modes.has("log")
		? yield* syncLog(bundle, walked, true, options.logSince, pending)
		: UNSELECTED;

	let restage: SyncPlan["restage"];
	if (options.staged !== undefined && repoRoot !== undefined) {
		const path = yield* Path.Path;
		// F5: the realpath map built in the staged-set loop above, filtered to
		// the ids `syncGenerated` would write -- no cast back to `ConceptId`
		// needed, since these keys were never anything else.
		const writtenIds = new Set(generated.written);
		const files = [
			...(realPaths === undefined
				? []
				: Array.from(realPaths.entries())
						.filter(([id]) => writtenIds.has(id))
						.map(([, real]) => real)),
			...index.written.map((relative) => path.join(bundle.root, relative)),
		];
		if (files.length > 0) restage = { repoRoot, files };
	}

	// Record each target's plan-time bytes so applySyncPlan can tell it was edited since.
	const fsForSnapshot = yield* FileSystem.FileSystem;
	const snapshotted: Array<PendingWrite> = [];
	for (const write of pending) {
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
	BundleLoadError | GeneratedAtError | SyncStagedLogError | SyncPlanStaleError,
	Git | GitHistory | FileSystem.FileSystem | Path.Path | Crypto.Crypto
> = Effect.fn("okfit/sync/runSync")(function* (options: SyncOptions) {
	const plan = yield* planSync(options);
	if (options.dryRun) return { ...plan.result, dryRun: true } satisfies SyncResult;
	return yield* applySyncPlan(plan);
});
