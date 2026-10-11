import { Doc, Fmt } from "@effected/cli";
import type { MultiSelectSection, MultiSelectState, Screen, ScreenControl, ViewportRow } from "@effected/cli/ui";
import { DocView, KeyHelp, MultiSelect, Styled, Viewport, useGlyphs, useKeys, useTerminalSize } from "@effected/cli/ui";
import type { ChangeSince, PickerCandidate } from "@okfit/engine";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * What the preview screen draws: the picker's sections (item values are
 * concept ids), the candidates behind them, and the drifted rows' previews.
 */
export interface PreviewScreenOptions {
	readonly message: string;
	readonly sections: ReadonlyArray<MultiSelectSection<string>>;
	readonly candidates: ReadonlyArray<PickerCandidate>;
	readonly previews: ReadonlyMap<string, ChangeSince>;
}

/** At this many usable columns or more the preview sits beside the list; below it, under the list. */
const SIDE_BY_SIDE = 100;
/** The list pane's share of a side-by-side layout. */
const LIST_SHARE = 0.45;
/** The message line above and the key help below. */
const CHROME = 2;
const GAP = 2;

/** Data drawn on one line: escapes and controls removed, line breaks folded to spaces. */
const oneLine = (text: string): string => Fmt.sanitize(text).replace(/[\r\n]+/g, " ");

/**
 * The patch from its first hunk on: the `diff --git`, `index`, `---` and `+++`
 * lines name the one file the row already names, and `---`/`+++` would be
 * painted as a removal and an addition.
 */
const hunksOf = (patch: string): ReadonlyArray<string> => {
	const lines = patch.replace(/\n$/, "").split("\n");
	const first = lines.findIndex((line) => line.startsWith("@@"));
	return first === -1 ? (patch.length === 0 ? [] : lines) : lines.slice(first);
};

const REASON_TEXT = {
	unbound: "no integrity binding records what was verified",
	"no-commit-before": "no commit at or before the verification",
	"not-a-repository": "not in a git repository (or its history could not be read)",
} as const;

/** The highlighted row's preview, cut to `lines` rows: its header, then the patch or why there is none. */
const Preview = (props: {
	readonly id: string | undefined;
	readonly detail: string | undefined;
	readonly candidate: PickerCandidate | undefined;
	readonly preview: ChangeSince | undefined;
	readonly lines: number;
}): ReactElement => {
	const { candidate, preview } = props;
	const body = Math.max(1, props.lines - 1);
	// Memoised on the patch and the budget, so moving the highlight away and back does not re-render the diff.
	const doc = useMemo(() => {
		if (preview?._tag !== "diff") return undefined;
		const hunks = hunksOf(preview.patch);
		if (hunks.length === 0) return undefined;
		const budget = Math.max(1, body - 1);
		return [Doc.diffText(hunks.join("\n"), hunks.length > budget ? { cap: Math.max(1, budget - 1) } : {})];
	}, [preview, body]);
	const header =
		props.id === undefined ? null : (
			<Text wrap="truncate-end">
				<Styled token="emphasis">{oneLine(props.id)}</Styled>
				{props.detail === undefined ? null : <Styled token="muted">{`  ${oneLine(props.detail)}`}</Styled>}
			</Text>
		);
	let content: ReactElement;
	if (candidate === undefined) content = <Text> </Text>;
	else if (candidate.integrity !== "drifted") content = <Styled token="muted">not drifted</Styled>;
	else if (preview === undefined) content = <Styled token="muted">no preview</Styled>;
	else if (preview._tag === "no-baseline")
		content = <Styled token="muted">{`no baseline to compare: ${REASON_TEXT[preview.reason]}`}</Styled>;
	else
		content = (
			<Box flexDirection="column">
				<Styled token="muted">{`changed since ${oneLine(preview.baseline)}:`}</Styled>
				{doc === undefined ? <Styled token="muted">(no textual difference)</Styled> : <DocView doc={doc} />}
			</Box>
		);
	return (
		<Box flexDirection="column" flexGrow={1} overflow="hidden">
			{header}
			{content}
		</Box>
	);
};

/**
 * The verify picker with a diff preview: the sections list on the left (below
 * on a narrow terminal, the preview under it), driven by `MultiSelect`'s own
 * reducer and keys, and the highlighted row's preview beside it: the patch since
 * its verification was bound, why there is no baseline, or `not drifted`.
 * Resolves the selected ids exactly as `MultiSelect.screen` does.
 */
export const PickerPreviewScreen = (
	props: PreviewScreenOptions & { readonly control: ScreenControl<ReadonlyArray<string>> },
): ReactElement => {
	const { sections, control } = props;
	const glyphs = useGlyphs();
	const { columns, rows: height } = useTerminalSize();
	const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
	const listRows = useMemo<ReadonlyArray<ViewportRow>>(
		() =>
			sections.flatMap((section) => [
				{ _tag: "Header", label: section.title } as const,
				...section.items.map((item) => ({ _tag: "Item", key: item.key }) as const),
			]),
		[sections],
	);
	const byId = useMemo(
		() => new Map(props.candidates.map((candidate) => [candidate.id, candidate])),
		[props.candidates],
	);

	const wide = columns >= SIDE_BY_SIDE;
	const space = Math.max(2, height - CHROME);
	const listLines = wide ? space : Math.max(1, Math.min(listRows.length, Math.floor(space / 2)));
	const previewLines = wide ? space : Math.max(2, space - listLines);
	const listWidth = wide ? Math.floor(columns * LIST_SHARE) : columns;

	// The handler steps from this ref, never from render state: one stdin read can carry several keys.
	const current = useRef<MultiSelectState<string> | undefined>(undefined);
	const [state, setState] = useState(() => {
		const initial = MultiSelect.init(sections, { height: listLines });
		current.current = initial;
		return initial;
	});
	useEffect(() => {
		const now = current.current;
		if (now === undefined || now.viewport.height === listLines) return;
		const resized = { ...now, viewport: Viewport.resize(now.viewport, listLines) };
		current.current = resized;
		setState(resized);
	}, [listLines]);
	useKeys(MultiSelect.keys, (action) => {
		const now = current.current;
		if (now === undefined) return;
		if (action === "cancel") {
			control.cancel("escape");
			return;
		}
		const next = MultiSelect.step(now, action);
		current.current = next;
		setState(next);
		if (action === "submit") control.resolve(MultiSelect.selected(next));
	});

	const on = glyphs.kind === "unicode" ? "◉" : "[x]";
	const off = glyphs.kind === "unicode" ? "◯" : "[ ]";
	const blank = " ".repeat(Fmt.width(glyphs.arrow));
	const ellipsis = { ellipsis: glyphs.ellipsis };
	const numberOf = new Map(items.map((item, index) => [item.key, index]));
	const renderRow = (row: ViewportRow, highlighted: boolean): ReactElement => {
		if (row._tag === "Header")
			return <Styled token="emphasis">{Fmt.truncate(oneLine(row.label), listWidth, ellipsis)}</Styled>;
		const index = numberOf.get(row.key) ?? -1;
		const label = oneLine(items[index]?.label ?? "");
		const text = Fmt.truncate(
			`${highlighted ? glyphs.arrow : blank} ${state.chosen.has(index) ? on : off} ${label}`,
			listWidth,
			ellipsis,
		);
		return highlighted ? <Styled token="accent">{text}</Styled> : <Text wrap="truncate-end">{text}</Text>;
	};

	const highlighted = items[state.viewport.cursor];
	const preview = (
		<Preview
			id={highlighted?.value}
			detail={highlighted?.detail}
			candidate={highlighted === undefined ? undefined : byId.get(highlighted.value)}
			preview={highlighted === undefined ? undefined : props.previews.get(highlighted.value)}
			lines={previewLines}
		/>
	);
	return (
		<Box flexDirection="column">
			<Styled token="emphasis">{Fmt.truncate(oneLine(props.message), columns, ellipsis)}</Styled>
			<Box flexDirection={wide ? "row" : "column"}>
				<Box
					flexDirection="column"
					flexShrink={0}
					overflow="hidden"
					{...(wide ? { width: `${Math.round(LIST_SHARE * 100)}%`, marginRight: GAP } : {})}
				>
					<Viewport.View rows={listRows} state={state.viewport} renderRow={renderRow} reserved={height - listLines} />
				</Box>
				{preview}
			</Box>
			<KeyHelp tables={[MultiSelect.keys]} />
		</Box>
	);
};

/**
 * The preview screen for `CliUi.run`, resolving with the selected ids (`[]`
 * when none are). Load this module through `CliUi.lazy` so React and Ink load
 * only when the screen mounts.
 */
export const previewScreen =
	(options: PreviewScreenOptions): Screen<ReadonlyArray<string>> =>
	(control) => <PickerPreviewScreen {...options} control={control} />;
