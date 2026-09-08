import type { Git } from "@effected/git";
import type { BundleLoadError, ConceptId, LoadedBundle, OkfitConfig } from "@okfit/core";
import { Bundle } from "@okfit/core";
import type { BodyProvenance, GeneratedAtError, GitHistory } from "@okfit/profiles";
import { Derivation } from "@okfit/profiles";
import type { FileSystem, Path } from "effect";
import { Effect, Schema } from "effect";
import { syncGenerated } from "./generated.js";
import { syncIndex } from "./index.js";
import { syncLog } from "./log.js";

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
	/** Already merged `DEFAULTS < profile < file` by the caller (D-28); unused today (`sync` never calls `profile.check`) but carried for parity with `RunOptions`. */
	readonly config: OkfitConfig;
	/** Members to actually RUN. Absent members still appear in {@link SyncResult}, `selected: false`. */
	readonly modes: ReadonlySet<SyncMode>;
	readonly dryRun: boolean;
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
 * Contract §5's six-step algorithm: one `Bundle.load`, one
 * `Derivation.generatedAt` per concept shared by the generated and log
 * modes (skipped entirely when neither is selected), then the three modes
 * in a FIXED order — generated, index, log — regardless of `--only`'s own
 * occurrence order, so a generated write never invalidates an index or log
 * rendered in the same run (design §2).
 *
 * @public
 */
export const runSync: (
	options: SyncOptions,
) => Effect.Effect<
	SyncResult,
	BundleLoadError | GeneratedAtError,
	Git | GitHistory | FileSystem.FileSystem | Path.Path
> = Effect.fn("okfit/sync/runSync")(function* (options: SyncOptions) {
	const bundle: LoadedBundle = yield* Bundle.load({ root: options.bundleRoot });

	// Step 2: one Derivation.generatedAt per concept, shared by generated and
	// log, computed only when at least one of them is selected. `--only index`
	// alone spawns no git process at all.
	const needsGit = options.modes.has("generated") || options.modes.has("log");
	const provenance = new Map<ConceptId, BodyProvenance>();
	if (needsGit) {
		for (const [id, concept] of bundle.concepts) {
			const derived = yield* Derivation.generatedAt({ file: `${bundle.root}/${concept.path}` });
			provenance.set(id, derived);
		}
	}

	const generated: SyncModeResult = options.modes.has("generated")
		? { selected: true, ...(yield* syncGenerated(bundle, provenance, options.dryRun)) }
		: UNSELECTED;
	const index: SyncModeResult = options.modes.has("index") ? yield* syncIndex(bundle, options.dryRun) : UNSELECTED;
	const log: SyncModeResult = options.modes.has("log")
		? yield* syncLog(bundle, provenance, options.dryRun)
		: UNSELECTED;

	return { bundleRoot: options.bundleRoot, dryRun: options.dryRun, generated, index, log } satisfies SyncResult;
});
