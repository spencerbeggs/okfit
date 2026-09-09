import { Schema } from "effect";
import type { SyncResult } from "../sync/run.js";
import { SkipReason } from "../sync/run.js";

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
	root: Schema.String,
	dry_run: Schema.Boolean,
	exit_code: Schema.Literal(0),
	generated: SyncModeEnvelope,
	index: SyncModeEnvelope,
	log: SyncModeEnvelope,
});
/** @public */
export type SyncEnvelope = typeof SyncEnvelope.Type;

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
	readonly result: SyncResult;
}): SyncEnvelope => ({
	schema: 1,
	okfit_version: input.okfitVersion,
	root: input.root,
	dry_run: input.dryRun,
	exit_code: 0,
	generated: toModeEnvelope(input.result.generated),
	index: toModeEnvelope(input.result.index),
	log: toModeEnvelope(input.result.log),
});
