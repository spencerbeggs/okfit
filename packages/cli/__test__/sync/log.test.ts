import { assert, describe, it } from "@effect/vitest";
import { DiagnosticRange, LogDocument, LogGroup, LogItem } from "@okfit/core";
import { Effect } from "effect";
import type { LogAddition } from "../../src/sync/log.js";
import { mergeLog } from "../../src/sync/log.js";

/**
 * One `## <date>` group as it would come out of `Bundle.load`'s
 * `parseLog`: `range` spans the heading through the byte just before the
 * next `## ` heading (or end of document for the last group) --
 * `internal/reserved.ts:193-206`'s own `flush`. `itemTexts` are only used
 * to build a plausible `LogItem` list; `mergeLog` never reads `items`,
 * only `range` (it re-emits the verbatim slice of `source`).
 */
const group = (source: string, date: string, itemTexts: ReadonlyArray<string>): LogGroup => {
	const offset = source.indexOf(`## ${date}`);
	if (offset === -1) throw new Error(`fixture source has no "## ${date}" heading`);
	const nextHeadingOffset = source.indexOf("\n## ", offset + 1);
	const end = nextHeadingOffset === -1 ? source.length : nextHeadingOffset + 1;
	return LogGroup.make({
		date,
		items: itemTexts.map((text) =>
			LogItem.make({ text, range: DiagnosticRange.fromOffset(source, offset, end - offset) }),
		),
		range: DiagnosticRange.fromOffset(source, offset, end - offset),
	});
};

describe("mergeLog", () => {
	it.effect("renders # Log and nothing else for an empty log with no additions", () =>
		Effect.sync(() => {
			assert.strictEqual(mergeLog(undefined, []), "# Log\n");
		}),
	);

	it.effect("creates one new group, newest first, for a brand-new date", () =>
		Effect.sync(() => {
			const additions: ReadonlyArray<LogAddition> = [
				{ date: "2026-09-01", title: "B", added: true },
				{ date: "2026-09-05", title: "A", added: true },
			];
			const result = mergeLog(undefined, additions);
			assert.strictEqual(result, "# Log\n\n## 2026-09-05\n* Added A\n\n## 2026-09-01\n* Added B\n");
		}),
	);

	it.effect("appends new items after an existing group's verbatim text, no deduplication", () =>
		Effect.sync(() => {
			const source = "# Log\n\n## 2026-09-01\n* Added Old\n";
			const doc = LogDocument.make({
				path: "log.md",
				dir: "",
				title: "Log",
				groups: [group(source, "2026-09-01", ["Added Old"])],
			});
			const additions: ReadonlyArray<LogAddition> = [{ date: "2026-09-01", title: "New Item", added: true }];
			const result = mergeLog({ doc, source }, additions);
			assert.strictEqual(result, "# Log\n\n## 2026-09-01\n* Added Old\n* Added New Item\n");
		}),
	);

	it.effect("sorts a new group's items by title, not by the Added/Updated prefix", () =>
		Effect.sync(() => {
			// Prefix-sort would put "Added Zeta" before "Updated Alpha" (A < U).
			// Title-sort must put Alpha before Zeta regardless of the prefix.
			const additions: ReadonlyArray<LogAddition> = [
				{ date: "2026-09-01", title: "Zeta", added: true },
				{ date: "2026-09-01", title: "Alpha", added: false },
			];
			const result = mergeLog(undefined, additions);
			assert.strictEqual(result, "# Log\n\n## 2026-09-01\n* Updated Alpha\n* Added Zeta\n");
		}),
	);

	it.effect("keeps every other existing group byte-identical when one group changes", () =>
		Effect.sync(() => {
			const source =
				"# Log\n\n## 2026-09-05\n* Added Newer\n\n## 2026-09-01\n* Added Old <!-- hand-written comment -->\n";
			const doc = LogDocument.make({
				path: "log.md",
				dir: "",
				title: "Log",
				groups: [
					group(source, "2026-09-05", ["Added Newer"]),
					group(source, "2026-09-01", ["Added Old <!-- hand-written comment -->"]),
				],
			});
			const additions: ReadonlyArray<LogAddition> = [{ date: "2026-09-05", title: "Another", added: true }];
			const result = mergeLog({ doc, source }, additions);
			assert.strictEqual(
				result,
				"# Log\n\n## 2026-09-05\n* Added Newer\n* Added Another\n\n## 2026-09-01\n* Added Old <!-- hand-written comment -->\n",
			);
		}),
	);
});
