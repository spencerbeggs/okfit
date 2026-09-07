import { FrontmatterSource } from "@effected/markdown";
import type { YamlNode, YamlParseError } from "@effected/yaml";
import { YamlAlias, YamlDocument, YamlMap, YamlScalar, YamlSeq } from "@effected/yaml";
import { Effect } from "effect";

/**
 * The classification of a concept's top-level `verified` value, with every
 * offset a WHOLE-FILE offset into the BOM-stripped source (V-12, contract
 * §3.1).
 *
 * `shape` on `unsupported` is one of `"alias"`, `"merge-key"`, `"scalar"`,
 * `"empty"` (contract §2.4's four), plus `"no-frontmatter"` and
 * `"not-a-mapping"` — both unreachable for a concept that reached
 * `bundle.concepts`, because `decodeConcept`'s own `isMapping` guard
 * rejects those before a `LoadedConcept` exists. They are named rather
 * than asserted because `locate` is a total pure function tested alone.
 *
 * @internal
 */
export type Located =
	| { readonly _tag: "absent"; readonly insertAt: number }
	| {
			readonly _tag: "blockSeq";
			readonly insertAt: number;
			readonly afterNewline: boolean;
			readonly indent: string;
			readonly lastItemStyle: "block" | "flow";
	  }
	| { readonly _tag: "flowSeq"; readonly insertAt: number; readonly empty: boolean }
	| {
			readonly _tag: "bareMapping";
			readonly style: "block" | "flow";
			readonly start: number;
			readonly end: number;
			readonly indent: string;
			readonly original: string;
			readonly endsWithNewline: boolean;
	  }
	| { readonly _tag: "unsupported"; readonly shape: string };

/**
 * Strip a leading BOM before anything else; the caller re-prepends `bom`
 * verbatim on write (V-15). `FrontmatterSource.split`'s own remarks require
 * this: "a leading BOM means offset 0 is not a fence — strip one before
 * calling" (`FrontmatterSource.ts:123`).
 *
 * @internal
 */
export const stripBom = (source: string): { readonly text: string; readonly bom: string } =>
	source.charCodeAt(0) === 0xfeff ? { text: source.slice(1), bom: "﻿" } : { text: source, bom: "" };

/** CRLF when the document's FIRST newline is CRLF, else LF (V-15). @internal */
export const detectNewline = (source: string): "\n" | "\r\n" => {
	const index = source.indexOf("\n");
	return index > 0 && source.charCodeAt(index - 1) === 0x0d ? "\r\n" : "\n";
};

/**
 * The terminator the spliced fragment must use: `split`'s own fidelity
 * field for the opening fence's terminator when it is LF or CRLF, else
 * {@link detectNewline}. `FrontmatterNewline` also admits a lone `"\r"`,
 * which no fragment may emit, so that case falls through to the scan.
 *
 * @internal
 */
export const documentNewline = (text: string): "\n" | "\r\n" => {
	const newline = FrontmatterSource.split(text).frontmatter?.newline;
	if (newline === "\r\n") return "\r\n";
	if (newline === "\n") return "\n";
	return detectNewline(text);
};

/** The run of spaces ending at `offset`, or `""` when anything else precedes it on the line. */
const indentAt = (value: string, offset: number): string => {
	const lineStart = value.lastIndexOf("\n", offset - 1) + 1;
	const prefix = value.slice(lineStart, offset);
	return /^ *$/.test(prefix) ? prefix : "";
};

/**
 * Trim a trailing run of whole comment lines off `raw`, keeping exactly one
 * leading newline of the run so a genuine trailing terminator survives.
 *
 * The composer's block-map/-seq range is the raw CST span
 * (`effected/packages/yaml/src/internal/composer/block.ts:119`,
 * `end = blockMapCst.offset + blockMapCst.length`), which silently extends
 * through a floating comment line that sits at a shallower indent than the
 * collection's own items — observed directly on the `comments.md` fixture: the
 * last item's `offset + length` lands on the NEXT top-level key's own offset,
 * with the comment's recovered text living on that key's `commentBefore`
 * rather than on any node inside the span. Trusting the raw span verbatim
 * would fold `# trailing frontmatter comment` into the inserted edit's
 * `length`, corrupting a comment the contract requires to stay untouched
 * (contract §3.4's `comments.md` row). This is the one place `locate`
 * doesn't take a node's `offset`/`length` at face value.
 */
const trimTrailingComment = (raw: string): string => {
	const match = /\n(?:[ \t]*#[^\n]*\n?)+$/.exec(raw);
	return match === null ? raw : raw.slice(0, match.index + 1);
};

/**
 * True when `node`, or any mapping directly inside a sequence `node`,
 * carries a `<<` key. That is every level a legal `Verification.List` can
 * reach; anything deeper already fails to decode as a `Verification`
 * (contract §11 item 3).
 */
const hasMergeKey = (node: YamlNode): boolean => {
	if (node instanceof YamlMap) {
		return node.items.some((pair) => pair.key instanceof YamlScalar && pair.key.value === "<<");
	}
	if (node instanceof YamlSeq) {
		return node.items.some((item) => item instanceof YamlMap && hasMergeKey(item));
	}
	return false;
};

/**
 * Split `source`'s frontmatter, parse its value, find the top-level
 * `verified` pair, and classify it (contract §3.1). Fails only when the
 * frontmatter YAML is fatally unparseable — impossible for a concept that
 * reached `bundle.concepts`, but typed rather than assumed.
 *
 * Offset translation is `valueStart = 3 + newline.length` — `"---".length`
 * plus the opening fence's own terminator, taken from `split`'s fidelity
 * field rather than re-derived with `indexOf` (contract §12 note 9). Every
 * whole-file offset below is `valueStart + <yaml offset>`.
 *
 * @internal
 */
export const locate = Effect.fn("okfit/verify/locate")(function* (
	source: string,
): Generator<Effect.Effect<YamlDocument, YamlParseError>, Located> {
	const block = FrontmatterSource.split(source).frontmatter;
	if (block === undefined) return { _tag: "unsupported", shape: "no-frontmatter" } as const;

	const value = block.value;
	const valueStart = 3 + (block.newline ?? "\n").length;

	const document = yield* YamlDocument.parse(value);
	const contents = document.contents;
	if (!(contents instanceof YamlMap)) return { _tag: "unsupported", shape: "not-a-mapping" } as const;

	const pair = contents.items.find((item) => item.key instanceof YamlScalar && item.key.value === "verified");
	if (pair === undefined) return { _tag: "absent", insertAt: valueStart + value.length } as const;

	const key = pair.key;
	const node = pair.value;
	if (node === null) return { _tag: "unsupported", shape: "empty" } as const;
	if (node instanceof YamlAlias) return { _tag: "unsupported", shape: "alias" } as const;
	if (hasMergeKey(node)) return { _tag: "unsupported", shape: "merge-key" } as const;
	if (node instanceof YamlScalar) return { _tag: "unsupported", shape: "scalar" } as const;

	if (node instanceof YamlSeq) {
		if (node.style === "flow") {
			return {
				_tag: "flowSeq",
				insertAt: valueStart + node.offset + node.length - 1,
				empty: node.items.length === 0,
			} as const;
		}
		const last = node.items[node.items.length - 1];
		if (last === undefined) return { _tag: "unsupported", shape: "empty" } as const;
		// A block-mapping item's span INCLUDES its trailing newline; a
		// flow-mapping item's span does NOT (contract §12 note 1). That single
		// fact is why `afterNewline` exists and why the two content spellings
		// in splice.ts differ. `trimTrailingComment` strips a floating comment
		// line the raw span may have swallowed (see its own doc comment).
		const end = last.offset + trimTrailingComment(value.slice(last.offset, last.offset + last.length)).length;
		return {
			_tag: "blockSeq",
			insertAt: valueStart + end,
			afterNewline: value[end - 1] === "\n",
			indent: indentAt(value, node.offset),
			lastItemStyle: last instanceof YamlMap && last.style === "flow" ? "flow" : "block",
		} as const;
	}

	if (node instanceof YamlMap) {
		// Start the replacement ONE BYTE PAST the key's colon, never at the
		// value node: starting at the node leaves `verified: ` with a trailing
		// space before the inserted newline (contract §12 note 2).
		const start = valueStart + key.offset + key.length + 1;
		const rawEnd = node.offset + node.length;
		const raw = value.slice(node.offset, rawEnd);
		const original = raw.replace(/(?:\r\n|\n|\r)$/, "");
		return {
			_tag: "bareMapping",
			style: node.style === "flow" ? "flow" : "block",
			start,
			end: valueStart + rawEnd,
			indent: `${indentAt(value, key.offset)}  `,
			original,
			endsWithNewline: original.length !== raw.length,
		} as const;
	}

	return { _tag: "unsupported", shape: "not-a-mapping" } as const;
});
