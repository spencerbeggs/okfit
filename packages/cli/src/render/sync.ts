import type { SkipReason, SyncResult } from "@okfit/engine";

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
