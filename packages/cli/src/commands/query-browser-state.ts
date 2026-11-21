import { Fmt } from "@effected/cli-kit";
import type { ConceptSummary } from "@okfit/engine";

/** One concept a concept links to or is linked from; `title` is `null` when the target is not a concept in the bundle. */
export interface BrowserNeighbor {
	readonly id: string;
	readonly kind: string;
	readonly title: string | null;
}

/** Everything the screen shows for one concept, read before the screen mounts. */
export interface BrowserDetail {
	readonly summary: ConceptSummary;
	/** The markdown body, frontmatter removed. */
	readonly body: string;
	readonly verified: ReadonlyArray<{ readonly by: string; readonly at: string }>;
	readonly outgoing: ReadonlyArray<BrowserNeighbor>;
	readonly incoming: ReadonlyArray<BrowserNeighbor>;
}

/** The whole bundle as the screen sees it: rows sorted by id, and a detail per row id. */
export interface BrowserData {
	readonly rows: ReadonlyArray<ConceptSummary>;
	readonly details: ReadonlyMap<string, BrowserDetail>;
}

/** The type and tag filters; `null` shows everything. */
export interface BrowserFilters {
	readonly type: string | null;
	readonly tag: string | null;
}

export type BrowserTab = "detail" | "neighbours";

/** Where the browser is. Pure data: nothing in it runs an Effect. */
export interface BrowserState {
	readonly data: BrowserData;
	readonly type: string | null;
	readonly tag: string | null;
	/** The selected concept id, `undefined` when no row passes the filters. */
	readonly current: string | undefined;
	readonly tab: BrowserTab;
	/** The first body line in view. */
	readonly scroll: number;
	/** The highlighted entry of the neighbours tab (outgoing, then incoming). */
	readonly neighbour: number;
	/** How many rows the list shows, for page moves. */
	readonly page: number;
}

/** What a key does to the browser. */
export type BrowserAction =
	| "up"
	| "down"
	| "home"
	| "end"
	| "pageup"
	| "pagedown"
	| "cycleType"
	| "cycleTag"
	| "clearFilters"
	| "follow"
	| { readonly _tag: "tab"; readonly tab: BrowserTab }
	| { readonly _tag: "scroll"; readonly by: number; readonly max: number }
	| { readonly _tag: "neighbour"; readonly by: number }
	| { readonly _tag: "resize"; readonly page: number };

/** The rows that pass the filters, in the order given. */
export const filterRows = (
	rows: ReadonlyArray<ConceptSummary>,
	filters: BrowserFilters,
): ReadonlyArray<ConceptSummary> =>
	rows.filter(
		(row) =>
			(filters.type === null || row.type === filters.type) && (filters.tag === null || row.tags.includes(filters.tag)),
	);

/** Rows grouped into one section per type, in order of first appearance; the order within a type is kept. */
export const groupByType = (
	rows: ReadonlyArray<ConceptSummary>,
): ReadonlyArray<{ readonly type: string; readonly rows: ReadonlyArray<ConceptSummary> }> => {
	const byType = new Map<string, Array<ConceptSummary>>();
	for (const row of rows) {
		const group = byType.get(row.type);
		if (group === undefined) byType.set(row.type, [row]);
		else group.push(row);
	}
	return [...byType].map(([type, group]) => ({ type, rows: group }));
};

/** The rows the list shows, top to bottom: filtered, then grouped by type. */
export const visibleRows = (data: BrowserData, filters: BrowserFilters): ReadonlyArray<ConceptSummary> =>
	groupByType(filterRows(data.rows, filters)).flatMap((group) => group.rows);

const sortedUnique = (values: Iterable<string>): ReadonlyArray<string> => [...new Set(values)].sort();

/** Every type in the bundle, sorted. */
export const typeOptions = (rows: ReadonlyArray<ConceptSummary>): ReadonlyArray<string> =>
	sortedUnique(rows.map((row) => row.type));

/** Every tag in the bundle, sorted. */
export const tagOptions = (rows: ReadonlyArray<ConceptSummary>): ReadonlyArray<string> =>
	sortedUnique(rows.flatMap((row) => row.tags));

/** The next value after `current` in `[null, ...options]`, wrapping back to `null` (no filter). */
export const cycle = (current: string | null, options: ReadonlyArray<string>): string | null => {
	if (options.length === 0) return null;
	if (current === null) return options[0] ?? null;
	const index = options.indexOf(current);
	return index === -1 || index === options.length - 1 ? null : (options[index + 1] ?? null);
};

/** A neighbours tab's entries: outgoing first, then incoming. */
export const neighbourEntries = (detail: BrowserDetail | undefined): ReadonlyArray<BrowserNeighbor> =>
	detail === undefined ? [] : [...detail.outgoing, ...detail.incoming];

/** The state to open with: the first visible concept selected, on the detail tab. */
export const browserInit = (data: BrowserData, page = 10): BrowserState => ({
	data,
	type: null,
	tag: null,
	current: visibleRows(data, { type: null, tag: null })[0]?.id,
	tab: "detail",
	scroll: 0,
	neighbour: 0,
	page,
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const select = (state: BrowserState, id: string | undefined): BrowserState =>
	id === state.current ? state : { ...state, current: id, scroll: 0, neighbour: 0 };

/** After the filters change: keep the selection when it still passes, else take the first row that does. */
const refilter = (state: BrowserState, filters: BrowserFilters): BrowserState => {
	const visible = visibleRows(state.data, filters);
	const keep = visible.some((row) => row.id === state.current);
	return select({ ...state, ...filters }, keep ? state.current : visible[0]?.id);
};

/**
 * One key's effect on the browser. Pure: the screen steps from the state it
 * last produced, so several keys from one read each see the one before.
 */
export const browserStep = (state: BrowserState, action: BrowserAction): BrowserState => {
	if (typeof action === "object") {
		switch (action._tag) {
			case "tab":
				return action.tab === state.tab ? state : { ...state, tab: action.tab };
			case "scroll":
				return { ...state, scroll: clamp(state.scroll + action.by, 0, Math.max(0, action.max)) };
			case "neighbour": {
				const count = neighbourEntries(
					state.current === undefined ? undefined : state.data.details.get(state.current),
				).length;
				return { ...state, neighbour: clamp(state.neighbour + action.by, 0, Math.max(0, count - 1)) };
			}
			case "resize":
				return action.page === state.page ? state : { ...state, page: Math.max(1, action.page) };
		}
	}
	switch (action) {
		case "up":
		case "down":
		case "home":
		case "end":
		case "pageup":
		case "pagedown": {
			const visible = visibleRows(state.data, state);
			if (visible.length === 0) return state;
			const at = Math.max(
				0,
				visible.findIndex((row) => row.id === state.current),
			);
			const target =
				action === "up"
					? at - 1
					: action === "down"
						? at + 1
						: action === "home"
							? 0
							: action === "end"
								? visible.length - 1
								: action === "pageup"
									? at - state.page
									: at + state.page;
			return select(state, visible[clamp(target, 0, visible.length - 1)]?.id);
		}
		case "cycleType":
			return refilter(state, { type: cycle(state.type, typeOptions(state.data.rows)), tag: state.tag });
		case "cycleTag":
			return refilter(state, { type: state.type, tag: cycle(state.tag, tagOptions(state.data.rows)) });
		case "clearFilters":
			return refilter(state, { type: null, tag: null });
		case "follow": {
			if (state.tab !== "neighbours" || state.current === undefined) return state;
			const target = neighbourEntries(state.data.details.get(state.current))[state.neighbour];
			if (target === undefined || !state.data.details.has(target.id)) return state;
			// A target the filters hide clears them, so the selection is always a visible row.
			const shown = visibleRows(state.data, state).some((row) => row.id === target.id);
			return select(shown ? state : { ...state, type: null, tag: null }, target.id);
		}
	}
};

/** Data drawn on one line: escapes and controls removed, line breaks folded to spaces. */
export const oneLine = (text: string): string => Fmt.sanitize(text).replace(/[\r\n]+/g, " ");

/**
 * The body as display lines at most `width` cells wide: each source line
 * sanitised, then wrapped at spaces (a word wider than `width` stays whole,
 * and the viewport clips it).
 */
export const wrapBody = (body: string, width: number): ReadonlyArray<string> => {
	const limit = Math.max(8, width);
	const out: Array<string> = [];
	for (const source of body.replace(/\s+$/, "").split(/\r?\n/)) {
		const line = Fmt.sanitize(source).replace(/\t/g, "  ");
		if (Fmt.width(line) <= limit) {
			out.push(line);
			continue;
		}
		const indent = /^\s*/.exec(line)?.[0] ?? "";
		let current = "";
		for (const word of line.trim().split(/\s+/)) {
			const next = current === "" ? `${indent}${word}` : `${current} ${word}`;
			if (current !== "" && Fmt.width(next) > limit) {
				out.push(current);
				current = `${indent}${word}`;
			} else current = next;
		}
		out.push(current);
	}
	return out;
};

/** The frontmatter-free body of a concept's markdown source. */
export const bodyOf = (source: string): string => {
	const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
	return (match === null ? source : source.slice(match[0].length)).replace(/^\s*\n/, "");
};

const MAX_VERIFIED = 3;

/** The detail pane's header lines (sanitised): title, id and type, description, trust, tags, verified entries. */
export const detailHeader = (detail: BrowserDetail): ReadonlyArray<string> => {
	const { summary } = detail;
	const shown = detail.verified.slice(0, MAX_VERIFIED);
	const more = detail.verified.length - shown.length;
	return [
		oneLine(summary.title),
		oneLine(`${summary.id}  (${summary.type})`),
		...(summary.description === null ? [] : [oneLine(summary.description)]),
		oneLine(
			`status: ${summary.status}  tier: ${summary.tier}  integrity: ${summary.integrity}  stale: ${summary.stale ? "yes" : "no"}`,
		),
		oneLine(`tags: ${summary.tags.length === 0 ? "(none)" : summary.tags.join(", ")}`),
		...shown.map((entry) => oneLine(`verified: ${entry.by} at ${entry.at}`)),
		...(more > 0 ? [`verified: +${more} more`] : []),
	];
};
