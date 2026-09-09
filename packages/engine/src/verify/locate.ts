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

/** The run of spaces ending at `offset`, or `""` when anything else precedes it on the line. @internal */
export const indentAt = (value: string, offset: number): string => {
	const lineStart = value.lastIndexOf("\n", offset - 1) + 1;
	const prefix = value.slice(lineStart, offset);
	return /^ *$/.test(prefix) ? prefix : "";
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
		// in splice.ts differ. `last.offset + last.length` is trusted verbatim:
		// as of yaml 0.14.0 (#643) the composer excludes a floating trailing
		// comment at a shallower indent than the collection's own items from
		// the span (it becomes the following key's `commentBefore` instead),
		// where earlier it silently extended through that comment line.
		const end = last.offset + last.length;
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

/**
 * The classification of a concept's `generated.at`, offsets whole-file
 * (same contract as {@link Located}). `insertAfterLastKey` covers "block
 * mapping without `at`" (S-2); `replaceScalar` covers "block mapping with
 * a plain or quoted `at`" (S-4); `unsupported` covers everything else
 * (S-3): not a block mapping (flow, scalar, sequence, null), a last-key
 * value that is not itself a scalar, an alias, a merge key, a block
 * scalar (`|`/`>`) `at`, or no top-level `generated` key at all (a
 * defensive case unreachable for a caller that already checked
 * `concept.frontmatter.generated !== undefined`, mirroring `locate`'s own
 * unreachable `"no-frontmatter"`/`"not-a-mapping"` shapes). The locator
 * MAY keep a finer `shape` string for its own tests; the report and the
 * JSON envelope carry only `generated-unsupported` (S-3).
 *
 * @internal
 */
export type GeneratedLocated =
	| { readonly _tag: "insertAfterLastKey"; readonly insertAt: number; readonly indent: string }
	| {
			readonly _tag: "replaceScalar";
			readonly start: number;
			readonly end: number;
			readonly quote: "plain" | "single-quoted" | "double-quoted";
	  }
	| { readonly _tag: "unsupported"; readonly shape: string };

/**
 * Locate the `at` key inside a concept's top-level `generated` BLOCK
 * mapping. Callers MUST have already confirmed `generated` exists on the
 * decoded concept (`generated-missing`, S-3/design §3 rule 5, is the
 * caller's check against `concept.frontmatter.generated`, never this
 * function's) — matches how `locate` already re-parses independently of
 * whatever `Bundle.load` retained, for `verified`. The insert style is
 * one new newline-terminated line after the last key's line of the
 * mapping, at that mapping's indent, using the document newline (S-2,
 * confirmed as already correct in FW's own proposal — contract §14 note
 * 1 — with no correction needed against this file's `locate` precedent).
 *
 * @internal
 */
const locateGeneratedField = Effect.fn("okfit/verify/locateGeneratedField")(function* (
	source: string,
	field: "at" | "body_sha256",
): Generator<Effect.Effect<YamlDocument, YamlParseError>, GeneratedLocated> {
	const block = FrontmatterSource.split(source).frontmatter;
	if (block === undefined) return { _tag: "unsupported", shape: "no-frontmatter" } as const;

	const value = block.value;
	const valueStart = 3 + (block.newline ?? "\n").length;

	const document = yield* YamlDocument.parse(value);
	const contents = document.contents;
	if (!(contents instanceof YamlMap)) return { _tag: "unsupported", shape: "not-a-mapping" } as const;

	const pair = contents.items.find((item) => item.key instanceof YamlScalar && item.key.value === "generated");
	if (pair === undefined) return { _tag: "unsupported", shape: "no-generated-key" } as const;

	const node = pair.value;
	if (node === null) return { _tag: "unsupported", shape: "empty" } as const;
	if (node instanceof YamlAlias) return { _tag: "unsupported", shape: "alias" } as const;
	if (hasMergeKey(node)) return { _tag: "unsupported", shape: "merge-key" } as const;
	if (node instanceof YamlScalar) return { _tag: "unsupported", shape: "scalar" } as const;
	if (node instanceof YamlSeq) return { _tag: "unsupported", shape: "sequence" } as const;
	if (!(node instanceof YamlMap)) return { _tag: "unsupported", shape: "not-a-mapping" } as const;
	if (node.style === "flow") return { _tag: "unsupported", shape: "flow-mapping" } as const;

	const indent = indentAt(value, node.offset);
	const fieldPair = node.items.find((item) => item.key instanceof YamlScalar && item.key.value === field);

	if (fieldPair === undefined) {
		const last = node.items[node.items.length - 1];
		if (last === undefined) return { _tag: "unsupported", shape: "empty" } as const;
		// S-2 / contract §14 note 1: seek the next newline after the last
		// item's own end and insert right after it -- a fully-terminated new
		// line, never the blockSeq `afterNewline` leading-newline style. Issue
		// #19: the SAME anchor (the mapping's last existing key) is reused for
		// `body_sha256` when absent -- in every fixture and every concept in
		// this repo `at` is itself the last key of `generated:` (`stale_after`
		// is a top-level sibling of `generated:`, never nested inside it), so
		// "after the last key" already means "after `at`" for the realistic
		// shape; `sync/generated.ts` additionally merges the two edits into one
		// when they land at the identical offset (both fields freshly stamped).
		const lastEnd = last.value !== null ? last.value.offset + last.value.length : last.key.offset + last.key.length;
		const nl = value.indexOf("\n", lastEnd);
		const insertAt = nl === -1 ? value.length : nl + 1;
		return { _tag: "insertAfterLastKey", insertAt: valueStart + insertAt, indent } as const;
	}

	const fieldValue = fieldPair.value;
	if (fieldValue === null) return { _tag: "unsupported", shape: `${field}-empty` } as const;
	if (fieldValue instanceof YamlAlias) return { _tag: "unsupported", shape: "alias" } as const;
	if (!(fieldValue instanceof YamlScalar)) return { _tag: "unsupported", shape: `${field}-not-scalar` } as const;
	if (fieldValue.style === "block-literal" || fieldValue.style === "block-folded")
		return { _tag: "unsupported", shape: `${field}-block-scalar` } as const;

	return {
		_tag: "replaceScalar",
		start: valueStart + fieldValue.offset,
		end: valueStart + fieldValue.offset + fieldValue.length,
		quote: fieldValue.style,
	} as const;
});

export const locateGenerated = (source: string): Effect.Effect<GeneratedLocated, YamlParseError> =>
	locateGeneratedField(source, "at");

/**
 * As {@link locateGenerated}, but for the top-level `generated.body_sha256`
 * key (issue #19). Shares every branch with `locateGenerated` -- the two
 * fields are siblings of the same `generated:` block mapping -- parametrized
 * only by which key name is sought.
 *
 * @internal
 */
export const locateGeneratedBodySha256 = (source: string): Effect.Effect<GeneratedLocated, YamlParseError> =>
	locateGeneratedField(source, "body_sha256");
