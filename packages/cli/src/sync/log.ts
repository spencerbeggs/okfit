import type { ConceptId, LoadedBundle, LogDocument } from "@okfit/core";
import { Derive } from "@okfit/core";
import type { BodyProvenance } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Path } from "effect";
import { writeAtomic } from "./write.js";

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
			// The raw slice, byte-for-byte, exactly as `LogGroup.range` spans it --
			// no normalisation. A non-last group's range spans through the blank
			// line (or lines, however many an author wrote) separating it from the
			// next `## ` heading (internal/reserved.ts's own `flush`); that trailer
			// is preserved untouched here and dealt with only where it matters,
			// at assembly time below (S-10: existing groups are byte-copied).
			const verbatim = existing.source.slice(group.range.offset, group.range.offset + group.range.length);
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

	const pieces = dates.map((date, index) => {
		const bucket = byDate.get(date);
		let piece: string;
		if (bucket === undefined) {
			piece = "";
		} else if (bucket.verbatim === undefined) {
			// A brand-new date: no existing text to preserve, rendered fresh
			// (S-11's per-group renderer). Ends in exactly one trailing newline.
			const items = [...bucket.pending].sort(byTitle).map(renderItem);
			piece = Derive.renderLogEntry({ date, items });
		} else if (bucket.pending.length === 0) {
			// Untouched: the raw slice, byte-for-byte, whatever its trailing
			// whitespace (one blank line, several, or none) happens to be.
			piece = bucket.verbatim;
		} else {
			// Existing text passes through verbatim; new items are appended as
			// "* <item>" lines immediately after the last existing one, no
			// deduplication against hand-written prose (design §5 step 4) --
			// but BEFORE any trailing blank-line whitespace the original slice
			// carries (its separator from the next heading, or end-of-document),
			// which is preserved byte-for-byte rather than collapsed.
			const trailingNewlines = /\n+$/.exec(bucket.verbatim)?.[0] ?? "";
			const base = bucket.verbatim.slice(0, bucket.verbatim.length - trailingNewlines.length);
			// One of the trailing newlines belongs to the last existing item's own
			// line ending, now supplied by the last appended item instead; the
			// rest (zero or more) are the original trailer, kept as-is.
			const trailer = trailingNewlines.slice(1);
			const appended = [...bucket.pending]
				.sort(byTitle)
				.map((item) => `* ${renderItem(item)}\n`)
				.join("");
			piece = `${base}\n${appended}${trailer}`;
		}
		// Every piece above ends in a single trailing newline UNLESS it is an
		// untouched raw slice that already carries its own separator (one or
		// more blank lines) through to the next heading. A rendered piece (new
		// group, or an appended existing one) needs a blank line inserted
		// before whatever follows it -- except when it is the last piece, where
		// no trailing blank line belongs at the end of the document.
		const isLast = index === dates.length - 1;
		return !isLast && !piece.endsWith("\n\n") ? `${piece}\n` : piece;
	});

	return dates.length === 0 ? `# ${title}\n` : `# ${title}\n\n${pieces.join("")}`;
};

/** @internal */
export interface SyncLogResult {
	readonly selected: true;
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: "log-unparseable" }>;
}

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
	// Step 3's early return already ruled out `source !== undefined &&
	// existingDoc === undefined`, so `existingDoc` is defined whenever
	// `source` is.
	const merged = mergeLog(
		source === undefined || existingDoc === undefined ? undefined : { doc: existingDoc, source },
		additions,
	);

	// Step 7: byte-compare; a missing file compares against "".
	if (merged === (source ?? "")) {
		return { selected: true, written: [], unchanged: ["log.md"], skipped: [] } satisfies SyncLogResult;
	}
	if (dryRun) {
		return { selected: true, written: ["log.md"], unchanged: [], skipped: [] } satisfies SyncLogResult;
	}

	// Step 8: one shared atomic writer across all three sync modes (S-33).
	yield* writeAtomic(logPath, merged);

	return { selected: true, written: ["log.md"], unchanged: [], skipped: [] } satisfies SyncLogResult;
});
