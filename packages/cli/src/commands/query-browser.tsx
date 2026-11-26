import { Fmt } from "@effected/cli-kit";
import type { Screen, ScreenControl, ViewportRow } from "@effected/cli-kit/ui";
import { KeyHelp, KeyTable, Styled, Tabs, Viewport, useGlyphs, useKeys, useTerminalSize } from "@effected/cli-kit/ui";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { useMemo, useRef, useState } from "react";
import { oneLine } from "../render/text.js";
import type { BrowserAction, BrowserData, BrowserNeighbor, BrowserState, BrowserTab } from "./query-browser-state.js";
import {
	browserInit,
	browserStep,
	detailHeader,
	groupByType,
	neighbourEntries,
	visibleRows,
	wrapBody,
} from "./query-browser-state.js";

type BrowserKey =
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
	| "scrollUp"
	| "scrollDown"
	| "quit"
	| "interrupt";

/** The browser's keys. Left/right and Tab belong to the tabs; Esc and q quit (a browser has nothing to cancel). */
const KEYS = KeyTable.make<BrowserKey>([
	{ keys: ["up"], action: "up", help: "up" },
	{ keys: ["down"], action: "down", help: "down" },
	{ keys: ["pageup"], action: "pageup", help: "page", hidden: true },
	{ keys: ["pagedown"], action: "pagedown", help: "page", hidden: true },
	{ keys: ["home"], action: "home", help: "top", hidden: true },
	{ keys: ["end"], action: "end", help: "bottom", hidden: true },
	{ keys: [{ char: "k" }], action: "scrollUp", help: "scroll up" },
	{ keys: [{ char: "j" }], action: "scrollDown", help: "scroll down" },
	{ keys: ["enter"], action: "follow", help: "follow link" },
	{ keys: [{ char: "t" }], action: "cycleType", help: "type filter" },
	{ keys: [{ char: "g" }], action: "cycleTag", help: "tag filter" },
	{ keys: [{ char: "c" }], action: "clearFilters", help: "clear filters" },
	{ keys: ["escape", { char: "q" }], action: "quit", help: "quit" },
	{ keys: ["ctrl+c"], action: "interrupt", help: "interrupt", hidden: true },
]);

const TABS: ReadonlyArray<{ readonly name: BrowserTab; readonly label: string }> = [
	{ name: "detail", label: "Detail" },
	{ name: "neighbours", label: "Neighbours" },
];

/** At this many usable columns or more the pane sits beside the list; below it, under the list. */
const SIDE_BY_SIDE = 100;
const LIST_SHARE = 0.4;
const GAP = 2;
/** The filter line above and the key help below. */
const CHROME = 2;

const ellipsisOf = (glyph: string) => ({ ellipsis: glyph });

const markers = (summary: { readonly integrity: string; readonly stale: boolean }): string =>
	[...(summary.integrity === "drifted" ? ["drifted"] : []), ...(summary.stale ? ["stale"] : [])].join("  ");

/** The browser screen: concept list, filters, and a detail / neighbours pane for the selected concept. */
export const QueryBrowserScreen = (props: {
	readonly data: BrowserData;
	readonly control: ScreenControl<void>;
}): ReactElement => {
	const { data, control } = props;
	const glyphs = useGlyphs();
	const { columns, rows: height } = useTerminalSize();
	const wide = columns >= SIDE_BY_SIDE;
	const space = Math.max(4, height - CHROME);
	const listWidth = wide ? Math.floor(columns * LIST_SHARE) : columns;
	const paneWidth = wide ? columns - listWidth - GAP : columns;

	const ref = useRef<BrowserState>(browserInit(data, Math.max(1, space)));
	const [state, setState] = useState<BrowserState>(ref.current);
	const apply = (action: BrowserAction) => {
		const next = browserStep(ref.current, action);
		if (next === ref.current) return;
		ref.current = next;
		setState(next);
	};

	const detail = state.current === undefined ? undefined : data.details.get(state.current);
	const header = useMemo(() => (detail === undefined ? [] : detailHeader(detail)), [detail]);
	const wrapped = useMemo(
		() => (detail === undefined ? [] : wrapBody(detail.body, paneWidth - 1)),
		[detail, paneWidth],
	);
	const entries = neighbourEntries(detail);

	// Space the pane has below the tab row (and, on the detail tab, its header).
	const listCount = visibleRows(data, state).length;
	const groupCount = groupByType(visibleRows(data, state)).length;
	const listLines = wide ? space : Math.max(2, Math.min(listCount + groupCount, Math.floor(space / 3)));
	const paneLines = wide ? space : Math.max(3, space - listLines);
	const bodyLines = Math.max(1, paneLines - 1 - header.length - 1);
	const neighbourLines = Math.max(1, paneLines - 1);
	const maxScroll = Math.max(0, wrapped.length - bodyLines);

	// The handler steps from refs, never render state: one stdin read can carry several keys.
	const limits = useRef({ maxScroll, page: listLines });
	limits.current = { maxScroll, page: listLines };

	useKeys(KEYS, (key) => {
		if (key === "quit") return control.resolve();
		if (key === "interrupt") return control.cancel("interrupt");
		const { maxScroll: max, page } = limits.current;
		if (page !== ref.current.page) apply({ _tag: "resize", page });
		if (key === "scrollUp" || key === "scrollDown") {
			const by = key === "scrollUp" ? -1 : 1;
			return ref.current.tab === "detail" ? apply({ _tag: "scroll", by, max }) : apply({ _tag: "neighbour", by });
		}
		apply(key);
	});

	const ellipsis = ellipsisOf(glyphs.ellipsis);
	const blank = " ".repeat(Fmt.width(glyphs.arrow));

	// The list: sections by type, only items selectable.
	const groups = groupByType(visibleRows(data, state));
	const listRows: ReadonlyArray<ViewportRow> = groups.flatMap((group) => [
		{ _tag: "Header", label: group.type } as const,
		...group.rows.map((row) => ({ _tag: "Item", key: row.id }) as const),
	]);
	const flat = groups.flatMap((group) => group.rows);
	const byKey = new Map(flat.map((row, index) => [row.id, { row, index }]));
	const cursor = Math.max(
		0,
		flat.findIndex((row) => row.id === state.current),
	);
	const listState = Viewport.init(flat.length, listLines, cursor);
	const renderListRow = (row: ViewportRow, highlighted: boolean): ReactElement => {
		if (row._tag === "Header")
			return <Styled token="emphasis">{Fmt.truncate(oneLine(row.label), listWidth, ellipsis)}</Styled>;
		const entry = byKey.get(row.key);
		const summary = entry?.row;
		const extra = summary === undefined ? "" : markers(summary);
		const text = Fmt.truncate(
			`${highlighted ? glyphs.arrow : blank} ${oneLine(summary?.id ?? "")}  ${oneLine(summary?.title ?? "")}${extra === "" ? "" : `  ${extra}`}`,
			listWidth,
			ellipsis,
		);
		return highlighted ? <Styled token="accent">{text}</Styled> : <Text wrap="truncate-end">{text}</Text>;
	};

	const filterLine = oneLine(
		`type: ${state.type ?? "all"}  tag: ${state.tag ?? "all"}  ${flat.length} of ${data.rows.length}`,
	);

	// The pane: tabs, then the detail or the neighbours.
	const bodyState = { cursor: state.scroll, offset: state.scroll, height: bodyLines, count: wrapped.length };
	const neighbourRows: ReadonlyArray<ViewportRow> = [
		...(detail === undefined || detail.outgoing.length === 0
			? []
			: [
					{ _tag: "Header", label: `outgoing (${detail.outgoing.length})` } as const,
					...detail.outgoing.map((n) => ({ _tag: "Item", key: `out:${n.id}` }) as const),
				]),
		...(detail === undefined || detail.incoming.length === 0
			? []
			: [
					{ _tag: "Header", label: `incoming (${detail.incoming.length})` } as const,
					...detail.incoming.map((n) => ({ _tag: "Item", key: `in:${n.id}` }) as const),
				]),
	];
	const neighbourByKey = new Map<string, BrowserNeighbor>([
		...(detail?.outgoing ?? []).map((n) => [`out:${n.id}`, n] as const),
		...(detail?.incoming ?? []).map((n) => [`in:${n.id}`, n] as const),
	]);
	const neighbourState = Viewport.init(entries.length, neighbourLines, state.neighbour);
	const renderNeighbour = (row: ViewportRow, highlighted: boolean): ReactElement => {
		if (row._tag === "Header") return <Styled token="emphasis">{oneLine(row.label)}</Styled>;
		const n = neighbourByKey.get(row.key);
		const label = n === undefined ? "" : oneLine(n.title === null ? `${n.id}  (${n.kind})` : `${n.id}  ${n.title}`);
		const text = Fmt.truncate(`${highlighted ? glyphs.arrow : blank} ${label}`, paneWidth, ellipsis);
		return highlighted ? <Styled token="accent">{text}</Styled> : <Text wrap="truncate-end">{text}</Text>;
	};

	const pane = (
		<Box flexDirection="column" flexGrow={1} overflow="hidden">
			<Tabs.View tabs={TABS} value={state.tab} onChange={(name) => apply({ _tag: "tab", tab: name })} />
			{detail === undefined ? (
				<Styled token="muted">no concept matches the filters</Styled>
			) : state.tab === "detail" ? (
				<Box flexDirection="column">
					{header.map((line, index) => (
						<Text key={`${index}:${line}`} wrap="truncate-end" bold={index === 0}>
							{line}
						</Text>
					))}
					<Styled token="muted">{Fmt.truncate("─".repeat(Math.max(1, paneWidth - 1)), paneWidth - 1, ellipsis)}</Styled>
					<Viewport.View
						rows={wrapped.map((_, index) => ({ _tag: "Item", key: String(index) }) as const)}
						state={bodyState}
						renderRow={(row) => (
							<Text wrap="truncate-end">{wrapped[Number(row._tag === "Item" ? row.key : 0)] || " "}</Text>
						)}
					/>
				</Box>
			) : entries.length === 0 ? (
				<Styled token="muted">no links to or from this concept</Styled>
			) : (
				<Viewport.View rows={neighbourRows} state={neighbourState} renderRow={renderNeighbour} />
			)}
		</Box>
	);

	return (
		<Box flexDirection="column">
			<Styled token="muted">{Fmt.truncate(filterLine, columns, ellipsis)}</Styled>
			<Box flexDirection={wide ? "row" : "column"}>
				<Box
					flexDirection="column"
					flexShrink={0}
					overflow="hidden"
					{...(wide ? { width: `${Math.round(LIST_SHARE * 100)}%`, marginRight: GAP } : {})}
				>
					{flat.length === 0 ? (
						<Styled token="muted">no concepts match the filters (c clears them)</Styled>
					) : (
						<Viewport.View rows={listRows} state={listState} renderRow={renderListRow} />
					)}
				</Box>
				{pane}
			</Box>
			<KeyHelp tables={[KEYS as KeyTable<unknown>, Tabs.keys as KeyTable<unknown>]} root={false} />
		</Box>
	);
};

/**
 * The browser for `CliUi.prompt`, resolving (`undefined`) on Esc or `q`: a
 * read-only browser has nothing to cancel. Ctrl-C still cancels with
 * `"interrupt"`. Load this module through `CliUi.lazy` so React and Ink load
 * only when it mounts.
 */
export const browserScreen =
	(data: BrowserData): Screen<void> =>
	(control) => <QueryBrowserScreen data={data} control={control} />;
