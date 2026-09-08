import { Schema } from "effect";
import type { SkipReason, SyncResult } from "../sync/run.js";

/** @public */
export const SyncModeEnvelope = Schema.Struct({
	selected: Schema.Boolean,
	written: Schema.Array(Schema.String),
	unchanged: Schema.Array(Schema.String),
	skipped: Schema.Array(Schema.Struct({ id: Schema.String, reason: Schema.String })),
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

/** Contract §9.2's fixed reason-sentence table, closed over `SkipReason`. */
const REASON_SENTENCE: Record<SkipReason, string> = {
	untracked: "not tracked by git",
	dirty: "has uncommitted changes",
	unborn: "the repository has no commits yet",
	"generated-missing": "has no generated block",
	"generated-unsupported": "generated.at is a shape sync cannot edit; edit it by hand",
	"log-unparseable": "log.md could not be parsed; see okfit validate",
};

const humanMode = (name: string, mode: SyncResult["generated"]): ReadonlyArray<string> => {
	if (!mode.selected) return [`${name}: not selected`];
	const lines: Array<string> = [`${name}:`];
	for (const id of mode.written) lines.push(`  wrote ${id}`);
	for (const id of mode.unchanged) lines.push(`  unchanged ${id}`);
	for (const entry of mode.skipped) {
		lines.push(`  skipped ${entry.id}: ${REASON_SENTENCE[entry.reason]}`);
	}
	return lines;
};

/**
 * Contract §9.2 (design §2): per mode, three lists, then a one-line
 * summary. A mode `--only` excluded from renders as `not selected` rather
 * than three empty lists — an implementer choice within the fixed JSON
 * shape (§14 makes no ruling on the human half; this is cosmetic).
 *
 * @public
 */
export const humanSync = (result: SyncResult): ReadonlyArray<string> => {
	const lines: Array<string> = [
		...humanMode("generated", result.generated),
		...humanMode("index", result.index),
		...humanMode("log", result.log),
	];
	const totalWritten = result.generated.written.length + result.index.written.length + result.log.written.length;
	const totalUnchanged =
		result.generated.unchanged.length + result.index.unchanged.length + result.log.unchanged.length;
	const totalSkipped = result.generated.skipped.length + result.index.skipped.length + result.log.skipped.length;
	lines.push(
		result.dryRun
			? `would write ${totalWritten}, unchanged ${totalUnchanged}, skipped ${totalSkipped} (dry run, nothing written)`
			: `wrote ${totalWritten}, unchanged ${totalUnchanged}, skipped ${totalSkipped}`,
	);
	return lines;
};
