import type { ConceptId, LoadedBundle } from "@okfit/core";
import { Derive, LogDocument } from "@okfit/core";
import type { BodyProvenance } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Path } from "effect";

/**
 * One log item sync would add: `date` is the addition's UTC calendar date
 * (`YYYY-MM-DD`), `title` is the concept's rendered title, `added` is
 * `true` for "Added <title>" and `false` for "Updated <title>".
 *
 * @internal
 */
export interface LogAddition {
	readonly date: string;
	readonly title: string;
	readonly added: boolean;
}

/** One pending date's accumulated state while merging. */
interface DateBucket {
	/** The existing group's verbatim source slice, or `undefined` for a brand-new date. */
	readonly verbatim: string | undefined;
	/** Additions not yet rendered into text, kept structured so sorting is by `title` (S-10, judge note 4). */
	readonly pending: Array<{ readonly title: string; readonly added: boolean }>;
}

const byTitle = (a: { readonly title: string }, b: { readonly title: string }): number =>
	a.title < b.title ? -1 : a.title > b.title ? 1 : 0;

const renderItem = (item: { readonly title: string; readonly added: boolean }): string =>
	item.added ? `Added ${item.title}` : `Updated ${item.title}`;

/**
 * S-10: takes STRUCTURED additions (`{date, title, added}`), not
 * pre-rendered strings -- this is the corrected shape of CP §2's own
 * proposal (contract §14 note 4): rendering "Added <title>"/
 * "Updated <title>" happens INSIDE `mergeLog`, so "sort by title" (design
 * §5 step 4) sorts the actual title field, never a substring of a
 * pre-rendered line. Renders a NEW group's items via
 * `Derive.renderLogEntry` (S-11's per-group renderer); an EXISTING
 * group's text (heading and items) is re-emitted verbatim by slicing
 * `existing.source` on the group's own `LogGroup.range` -- never
 * re-serialised, so a hand-written item, comment, or unusual formatting
 * inside an existing group survives byte-for-byte.
 *
 * @internal
 */
export const mergeLog = (
	existing: { readonly doc: LogDocument; readonly source: string } | undefined,
	additions: ReadonlyArray<LogAddition>,
): string => {
	const title = existing?.doc.title ?? "Log";
	const byDate = new Map<string, DateBucket>();

	if (existing !== undefined) {
		for (const group of existing.doc.groups) {
			const slice = existing.source.slice(group.range.offset, group.range.offset + group.range.length);
			// A non-last group's range spans through the blank line separating it
			// from the next `## ` heading (internal/reserved.ts's own `flush`), so
			// its slice can end in `\n\n` rather than the single `\n` every other
			// group boundary (Derive.renderLogEntry's own output, and the last
			// group's own range) ends in. Trimming to exactly one trailing
			// newline here keeps every element `rendered` produces consistent,
			// so the final `rendered.join("\n")` reproduces the original blank
			// line between groups exactly once, whether a group is untouched or
			// gains new items.
			const verbatim = slice.replace(/\n+$/, "\n");
			byDate.set(group.date, { verbatim, pending: [] });
		}
	}

	for (const addition of additions) {
		const bucket = byDate.get(addition.date) ?? { verbatim: undefined, pending: [] };
		bucket.pending.push({ title: addition.title, added: addition.added });
		byDate.set(addition.date, bucket);
	}

	// Newest first: ISO YYYY-MM-DD strings sort lexically (S-21).
	const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

	const rendered = dates.map((date) => {
		const bucket = byDate.get(date);
		if (bucket === undefined) return "";
		if (bucket.verbatim === undefined) {
			const items = [...bucket.pending].sort(byTitle).map(renderItem);
			return Derive.renderLogEntry({ date, items });
		}
		if (bucket.pending.length === 0) return bucket.verbatim;
		// Existing text passes through verbatim; new items are appended as
		// "* <item>" lines after it, no deduplication against hand-written
		// prose (design §5 step 4).
		const appended = [...bucket.pending]
			.sort(byTitle)
			.map((item) => `* ${renderItem(item)}\n`)
			.join("");
		return `${bucket.verbatim}${appended}`;
	});

	return dates.length === 0 ? `# ${title}\n` : `# ${title}\n\n${rendered.join("\n")}`;
};

/** @internal */
export interface SyncLogResult {
	readonly selected: true;
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: "log-unparseable" }>;
}

const EMPTY_LOG_DOCUMENT = LogDocument.make({ path: "log.md", dir: "", groups: [] });

/**
 * Contract §8.2. Only the root `log.md`; `bundle.concepts` is the only
 * thing scanned -- `index.md`/`log.md` are reserved files, never concepts
 * (S-22, contract §14 note 8 -- closes PB's Open question 1 outright: an
 * `Updated index`/`Updated log` line can never occur).
 *
 * @internal
 */
export const syncLog = Effect.fn("okfit/sync/syncLog")(function* (
	bundle: LoadedBundle,
	provenance: ReadonlyMap<ConceptId, BodyProvenance>,
	dryRun: boolean,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const logPath = path.join(bundle.root, "log.md");

	// Step 1: missing file -> undefined source (empty document, design §5 step 1).
	const source = yield* fs.readFileString(logPath).pipe(
		Effect.map((text) => text as string | undefined),
		Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
	);

	// Step 2.
	const existingDoc = bundle.logs.get("");

	// Step 3: a fatal parse failure -- validate already reports this as
	// log-frontmatter/conformance; this mode returns early with one skip.
	if (source !== undefined && existingDoc === undefined) {
		return {
			selected: true,
			written: [],
			unchanged: [],
			skipped: [{ id: "log.md", reason: "log-unparseable" as const }],
		} satisfies SyncLogResult;
	}

	// Step 4: the greatest `## YYYY-MM-DD` group date, or undefined.
	const newestLogged = (existingDoc?.groups ?? [])
		.map((entryGroup) => entryGroup.date)
		.reduce<string | undefined>((max, date) => (max === undefined || date > max ? date : max), undefined);

	// Step 5.
	const additions: Array<LogAddition> = [];
	for (const [id, concept] of bundle.concepts) {
		const derived = provenance.get(id);
		if (derived === undefined || derived._tag !== "committed") continue;
		const date = DateTime.formatIsoDate(derived.at);
		if (newestLogged !== undefined && date <= newestLogged) continue;
		additions.push({ date, title: Derive.title(concept), added: derived.creating });
	}

	// Step 6.
	const merged = mergeLog(
		source === undefined ? undefined : { doc: existingDoc ?? EMPTY_LOG_DOCUMENT, source },
		additions,
	);

	// Step 7: byte-compare; a missing file compares against "".
	if (merged === (source ?? "")) {
		return { selected: true, written: [], unchanged: ["log.md"], skipped: [] } satisfies SyncLogResult;
	}
	if (dryRun) {
		return { selected: true, written: ["log.md"], unchanged: [], skipped: [] } satisfies SyncLogResult;
	}

	// Step 8: atomic write, same discipline as generated mode (§6.2 step 12).
	const tempPath = `${logPath}.okfit-sync.tmp`;
	yield* fs.writeFileString(tempPath, merged);
	yield* fs.rename(tempPath, logPath);

	return { selected: true, written: ["log.md"], unchanged: [], skipped: [] } satisfies SyncLogResult;
});
