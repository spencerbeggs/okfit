import { Schema } from "effect";
import type { SyncResult } from "../sync/run.js";
import { SkipReason } from "../sync/run.js";
import { ENGINE_VERSION } from "../version.js";
import type { Distribution } from "./distribution.js";
import { DistributionField } from "./distribution.js";

/** @public */
export const SyncModeEnvelope = Schema.Struct({
	selected: Schema.Boolean,
	written: Schema.Array(Schema.String),
	unchanged: Schema.Array(Schema.String),
	skipped: Schema.Array(Schema.Struct({ id: Schema.String, reason: SkipReason })),
});
/** @public */
export type SyncModeEnvelope = typeof SyncModeEnvelope.Type;

/**
 * One `okfit sync --publication` result: the Publication id, whether its
 * file changed, and the digest stamped for each rendered source.
 *
 * @public
 */
export const PublicationEnvelope = Schema.Struct({
	id: Schema.String,
	written: Schema.Boolean,
	digests: Schema.Array(Schema.Struct({ path: Schema.String, body_sha256: Schema.String })),
});
/** @public */
export type PublicationEnvelope = typeof PublicationEnvelope.Type;

/**
 * Contract §14 note 5: `schema: 1` is INFERRED, not in the design's own
 * §2 JSON example — every other envelope in this codebase
 * (`JsonEnvelope`, `VerifyEnvelope`, `ContextEnvelope`) opens with it, so
 * this one does too. `exit_code` is the literal `0`: `sync` has no
 * content tier (unlike `validate`'s `0 | 1 | 2`) and this envelope only
 * exists on the success path — a failure produces `JsonErrorEnvelope`
 * (K-22) instead, unchanged.
 *
 * @public
 */
export const SyncEnvelope = Schema.Struct({
	schema: Schema.Literal(1),
	okfit_version: Schema.String,
	engine_version: Schema.String,
	distribution: DistributionField,
	root: Schema.String,
	dry_run: Schema.Boolean,
	exit_code: Schema.Literal(0),
	generated: SyncModeEnvelope,
	index: SyncModeEnvelope,
	log: SyncModeEnvelope,
	/** Present only for `okfit sync --publication`; then the three modes are all `selected: false`. */
	publication: Schema.optionalKey(PublicationEnvelope),
});
/** @public */
export type SyncEnvelope = typeof SyncEnvelope.Type;

const NOT_SELECTED: SyncModeEnvelope = { selected: false, written: [], unchanged: [], skipped: [] };

const toModeEnvelope = (mode: SyncResult["generated"]): SyncModeEnvelope => ({
	selected: mode.selected,
	written: [...mode.written],
	unchanged: [...mode.unchanged],
	skipped: mode.skipped.map((entry) => ({ id: entry.id, reason: entry.reason })),
});

/**
 * `root` alone goes through `displayRoot` at the call site
 * (`commands/sync.ts`) — `generated`/`index`/`log`'s own lists are
 * already bundle-relative and need no cwd-relativisation (contract §9.1).
 *
 * @public
 */
export const syncEnvelope = (input: {
	readonly okfitVersion: string;
	readonly root: string;
	readonly dryRun: boolean;
	readonly result?: SyncResult;
	readonly publication?: PublicationEnvelope;
	readonly distribution?: Distribution;
}): SyncEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	engine_version: ENGINE_VERSION,
	distribution: input.distribution ?? null,
	root: input.root,
	dry_run: input.dryRun,
	exit_code: 0,
	generated: input.result === undefined ? NOT_SELECTED : toModeEnvelope(input.result.generated),
	index: input.result === undefined ? NOT_SELECTED : toModeEnvelope(input.result.index),
	log: input.result === undefined ? NOT_SELECTED : toModeEnvelope(input.result.log),
	...(input.publication === undefined ? {} : { publication: input.publication }),
});
