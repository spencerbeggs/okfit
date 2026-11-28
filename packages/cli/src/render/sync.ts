import { GENERATED_AT_TOLERANCE_TEXT, INTEGRITY_KEY } from "@okfit/core";
import type { PublicationEnvelope, SkipReason, SyncResult } from "@okfit/engine";
import { ProfileKeys } from "@okfit/profiles";

/** Contract §9.2's fixed reason-sentence table, closed over `SkipReason`. */
const REASON_SENTENCE: Record<SkipReason, string> = {
	untracked: "not tracked by git; add the file to git and commit it, then run okfit sync again",
	dirty: "has uncommitted changes; commit the change, then run okfit sync again",
	unborn: "the repository has no commits yet",
	"generated-missing":
		"has no generated block and actors.agent is not configured; set generated.by by hand or configure actors.agent",
	"generated-unsupported": "generated.at is a shape sync cannot edit; edit it by hand",
	"integrity-unsupported": `${INTEGRITY_KEY} is a shape sync cannot edit; edit it by hand`,
	"renders-unsupported": `${ProfileKeys.renders} is a shape sync cannot edit (flow style); edit it by hand`,
	"log-unparseable": "log.md could not be parsed; see okfit validate",
	"index-unparseable":
		"could not be read (its frontmatter does not close or does not parse); fix it by hand (see okfit validate), then run okfit sync again",
	"legacy-key-conflict":
		"carries both the old and the new spelling of an okfit key; keep the new one, move any value you need into it, delete the old one, then run okfit sync again",
	"legacy-key-unsupported":
		"has an old okfit key that sync cannot rename in place (flow style, an alias or a `<<` merge in the old block, a duplicate or an explicit `?` key); rename it by hand to the new spelling",
	"symlink-escape": "is a symbolic link that leaves the bundle, so it is not read or written",
	"changed-during-read": "changed while it was read, so it was not rewritten; run okfit sync again",
	"verified-after-now":
		"has a verification that a re-stamp would make current; a human must correct generated.at or that verification",
};

const humanMode = (name: string, mode: SyncResult["generated"], dryRun: boolean): ReadonlyArray<string> => {
	if (!mode.selected) return [`${name}: not selected`];
	const lines: Array<string> = [`${name}:`];
	for (const id of mode.written) lines.push(`  wrote ${id}`);
	for (const id of mode.migrated) lines.push(`  migrated ${id}`);
	for (const id of mode.unchanged) lines.push(`  unchanged ${id}`);
	for (const entry of mode.skipped) {
		// A concept that could not be stamped still has its old okfit keys renamed: say so beside the reason.
		const renamed = mode.migrated.includes(entry.id)
			? ` (its old okfit keys ${dryRun ? "would still be" : "are still"} renamed)`
			: "";
		const sentence =
			entry.reason === "verified-after-now" && entry.generatedAt !== undefined && entry.verifiedAt !== undefined
				? `generated.at ${entry.generatedAt} is later than now, but re-stamping it would make the verification dated ${entry.verifiedAt} count without a re-verification; a human must correct generated.at or that verification`
				: REASON_SENTENCE[entry.reason];
		lines.push(`  skipped ${entry.id}: ${sentence}${renamed}`);
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
		...humanMode("generated", result.generated, result.dryRun),
		...humanMode("index", result.index, result.dryRun),
		...humanMode("log", result.log, result.dryRun),
	];
	const totalWritten = result.generated.written.length + result.index.written.length + result.log.written.length;
	const totalMigrated = result.generated.migrated.length + result.index.migrated.length + result.log.migrated.length;
	const totalUnchanged =
		result.generated.unchanged.length + result.index.unchanged.length + result.log.unchanged.length;
	const totalSkipped = result.generated.skipped.length + result.index.skipped.length + result.log.skipped.length;
	lines.push(
		result.dryRun
			? `would write ${totalWritten}, migrated ${totalMigrated}, unchanged ${totalUnchanged}, skipped ${totalSkipped} (dry run, nothing written)`
			: `wrote ${totalWritten}, migrated ${totalMigrated}, unchanged ${totalUnchanged}, skipped ${totalSkipped}`,
	);
	return lines;
};

/**
 * #509: the one stderr line for a run that saw `generated.at` stamps or commit dates ahead of its clock; `undefined`
 * when it saw none. It says the clock may be behind and what sync does with such a stamp, never that it re-stamped one.
 *
 * @public
 */
export const humanClockWarning = (result: SyncResult): string | undefined => {
	const behind = result.clockBehind;
	if (behind === undefined) return undefined;
	return `warning: ${behind.concepts.length} concept(s) carry a generated.at or commit date more than ${GENERATED_AT_TOLERANCE_TEXT} later than now (${behind.now}; the latest is ${behind.latest}), so this machine's clock may be behind; sync treats each as ahead of the clock: it re-stamps it to now, or lists it as skipped when that would make a verification count`;
};

/**
 * Human output for `okfit sync --publication`: one line per rendered source's
 * digest, then whether the Publication file changed.
 *
 * @public
 */
export const humanPublication = (result: PublicationEnvelope, dryRun: boolean): ReadonlyArray<string> => [
	`publication ${result.id}:`,
	...result.digests.map((d) => `  ${d.path} ${d.body}`),
	result.written
		? dryRun
			? `would restamp ${result.id} (dry run, nothing written)`
			: `restamped ${result.id}`
		: `unchanged ${result.id}`,
];
