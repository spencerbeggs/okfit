import { MarkdownEdit } from "@effected/markdown";
import type { YamlDocument, YamlNode, YamlParseError } from "@effected/yaml";
import { YamlAlias, YamlMap, YamlScalar, YamlSeq } from "@effected/yaml";
import { Integrity, Timestamp } from "@okfit/core";
import { Effect, Schema } from "effect";
import type { ParsedTopLevelMapping } from "./locate.js";
import { hasMergeKey, parseTopLevelMapping } from "./locate.js";

/**
 * Where okfit's own top-level `integrity` block lives (whole-file offsets into
 * the BOM-stripped source). `absent` is the end of the frontmatter value;
 * `replace` spans the key's line through the terminator of its last nested
 * line, and `current` is the block decoded through the `Integrity` schema
 * (`undefined` when malformed or null). A malformed block is still
 * replaceable, because okfit owns it.
 *
 * @internal
 */
export type IntegrityLocated =
	| { readonly _tag: "absent"; readonly insertAt: number }
	| {
			readonly _tag: "replace";
			readonly start: number;
			readonly end: number;
			readonly current: Integrity | undefined;
	  }
	| { readonly _tag: "unsupported"; readonly shape: string };

const decodeIntegrity = Schema.decodeUnknownOption(Integrity);

/**
 * The plain value of `node` with every plain scalar kept as its source text:
 * a digest such as `0000000000000000` or `1234567890123456` is a YAML number
 * to `toValue()`, but the `Digest` schema wants the string okfit wrote.
 */
const rawValue = (node: YamlNode | null, text: string): unknown => {
	if (node instanceof YamlMap) {
		const out: Record<string, unknown> = {};
		for (const item of node.items) {
			if (item.key instanceof YamlScalar) {
				Object.defineProperty(out, String(item.key.value), {
					value: rawValue(item.value, text),
					writable: true,
					enumerable: true,
					configurable: true,
				});
			}
		}
		return out;
	}
	if (node instanceof YamlScalar && node.style === "plain" && node.value !== null) {
		return text.slice(node.offset, node.offset + node.length);
	}
	return node === null ? null : node.toValue();
};

const isKey = (name: string) => (item: YamlMap["items"][number]) =>
	item.key instanceof YamlScalar && item.key.value === name;

/** Start of the line holding `offset`, to just past the next terminator at or after `tail`. */
const lineSpan = (value: string, keyOffset: number, tail: number): { start: number; end: number } | undefined => {
	const start = value.lastIndexOf("\n", keyOffset - 1) + 1;
	if (value.slice(start, keyOffset).trim() !== "") return undefined;
	// A node whose span already ends in a terminator (block scalar, block map) needs no further seek.
	const end =
		tail > 0 && value[tail - 1] === "\n"
			? tail
			: (() => {
					const nl = value.indexOf("\n", tail);
					return nl === -1 ? value.length : nl + 1;
				})();
	return start >= end ? undefined : { start, end };
};

/**
 * Locate the top-level `integrity` key. See {@link IntegrityLocated}.
 *
 * @internal
 */
export const locateIntegrity = Effect.fn("okfit/verify/locateIntegrity")(function* (
	source: string,
): Generator<
	Effect.Effect<YamlDocument, YamlParseError> | Effect.Effect<ParsedTopLevelMapping, YamlParseError>,
	IntegrityLocated
> {
	const parsed = yield* parseTopLevelMapping(source);
	if ("_tag" in parsed) return parsed;
	const { value, valueStart, contents } = parsed;
	if (contents.style === "flow") return { _tag: "unsupported", shape: "flow-document" } as const;

	const pair = contents.items.find(isKey("integrity"));
	if (pair === undefined) return { _tag: "absent", insertAt: valueStart + value.length } as const;

	const node = pair.value;
	const isNull =
		node === null ||
		(node instanceof YamlScalar &&
			node.style === "plain" &&
			node.value === null &&
			node.tag === undefined &&
			node.anchor === undefined);
	if (!isNull) {
		if (node instanceof YamlAlias) return { _tag: "unsupported", shape: "alias" } as const;
		if (hasMergeKey(node)) return { _tag: "unsupported", shape: "merge-key" } as const;
		if (node instanceof YamlScalar) return { _tag: "unsupported", shape: "scalar" } as const;
		if (node instanceof YamlSeq) return { _tag: "unsupported", shape: "sequence" } as const;
		if (!(node instanceof YamlMap)) return { _tag: "unsupported", shape: "not-a-mapping" } as const;
		if (node.style === "flow") return { _tag: "unsupported", shape: "flow-mapping" } as const;
	}

	const keyEnd = pair.key.offset + pair.key.length;
	let tail = node === null ? keyEnd : Math.max(keyEnd, node.offset + node.length);
	if (node instanceof YamlMap) {
		const last = node.items[node.items.length - 1];
		if (last !== undefined) {
			const lastEnd = last.value !== null ? last.value.offset + last.value.length : last.key.offset + last.key.length;
			tail = Math.max(keyEnd, lastEnd);
		}
	}
	const span = lineSpan(value, pair.key.offset, tail);
	if (span === undefined) return { _tag: "unsupported", shape: "not-a-mapping" } as const;

	const current =
		node instanceof YamlMap
			? decodeIntegrity(rawValue(node, value)).pipe((o) => (o._tag === "Some" ? o.value : undefined))
			: undefined;
	return { _tag: "replace", start: valueStart + span.start, end: valueStart + span.end, current } as const;
});

/** What YAML 1.2 Core resolves to a number: all digits, or digits `e` digits. */
const NUMERIC_DIGEST = /^[0-9]+(?:e[0-9]+)?$/u;

/**
 * A digest as okfit writes it: single-quoted exactly when YAML 1.2 Core would
 * resolve the plain spelling to a number (all digits, or digits `e` digits),
 * so a reader always gets the string back; plain otherwise.
 *
 * @internal
 */
export const formatDigest = (digest: string): string => (NUMERIC_DIGEST.test(digest) ? `'${digest}'` : digest);

/** The slots {@link renderIntegrity} writes; an absent slot is omitted. @internal */
export interface IntegrityFields {
	readonly generated?: { readonly body: string };
	readonly verified?: { readonly by: string; readonly at: string; readonly content: string };
}

/**
 * The canonical block YAML for `fields`, fixed key order, terminator after
 * every line; `""` when both slots are absent. Never a YAML serialiser.
 *
 * @internal
 */
export const renderIntegrity = (fields: IntegrityFields, newline: "\n" | "\r\n"): string => {
	const lines: Array<string> = [];
	if (fields.generated !== undefined) lines.push("  generated:", `    body: ${formatDigest(fields.generated.body)}`);
	if (fields.verified !== undefined) {
		lines.push(
			"  verified:",
			`    by: ${fields.verified.by}`,
			`    at: ${fields.verified.at}`,
			`    content: ${formatDigest(fields.verified.content)}`,
		);
	}
	return lines.length === 0 ? "" : ["integrity:", ...lines].map((line) => `${line}${newline}`).join("");
};

/**
 * The one edit that writes `fields` as the whole `integrity` block (insert
 * when absent, replace otherwise); deletes the block when `fields` is empty.
 *
 * @internal
 */
export const spliceIntegrity = (
	target: Exclude<IntegrityLocated, { readonly _tag: "unsupported" }>,
	fields: IntegrityFields,
	newline: "\n" | "\r\n",
): MarkdownEdit =>
	MarkdownEdit.make({
		offset: target._tag === "absent" ? target.insertAt : target.start,
		length: target._tag === "absent" ? 0 : target.end - target.start,
		content: renderIntegrity(fields, newline),
	});

const encodeAt = Schema.encodeSync(Timestamp);

/** The already-valid `slot` of a located block as render fields, for the whole-block fallback. */
const carried = (
	target: Exclude<IntegrityLocated, { readonly _tag: "unsupported" }>,
	slot: "generated" | "verified",
): IntegrityFields => {
	const current = target._tag === "replace" ? target.current : undefined;
	if (slot === "generated")
		return current?.generated === undefined ? {} : { generated: { body: current.generated.body } };
	return current?.verified === undefined
		? {}
		: { verified: { by: current.verified.by, at: encodeAt(current.verified.at), content: current.verified.content } };
};

/**
 * Rewrite only one slot of the located `integrity` block, copying every other
 * line byte-identically. A missing slot is added first (`generated`) or last
 * (`verified`), matching {@link renderIntegrity}'s order. An absent block, or a
 * layout this cannot match, falls back to writing the whole block with the
 * other slot carried over from `target.current`.
 */
const spliceSlot = (
	target: Exclude<IntegrityLocated, { readonly _tag: "unsupported" }>,
	text: string,
	slot: "generated" | "verified",
	slotLines: (indent: string, newline: "\n" | "\r\n") => string,
	whole: IntegrityFields,
	newline: "\n" | "\r\n",
): MarkdownEdit => {
	const fallback = () => spliceIntegrity(target, whole, newline);
	if (target._tag === "absent") return fallback();
	const lines = text.slice(target.start, target.end).match(/[^\n]*\n|[^\n]+$/gu) ?? [];
	const bare = (line: string) => line.replace(/\r?\n$/u, "");
	if (lines.length < 2 || !/^integrity:[ \t]*$/u.test(bare(lines[0] ?? ""))) return fallback();
	const first = lines.slice(1).find((line) => bare(line).trim() !== "" && !/^[ \t]*#/u.test(bare(line)));
	const indent = /^[ \t]*/u.exec(first ?? "")?.[0] ?? "";
	if (indent === "") return fallback();
	const text_ = slotLines(indent, newline);
	const at = lines.findIndex((line, i) => i > 0 && new RegExp(`^${indent}${slot}[ \\t]*:`, "u").test(bare(line)));
	let out: Array<string>;
	if (at === -1) {
		out =
			slot === "generated"
				? [lines[0] as string, text_, ...lines.slice(1)]
				: [...lines, ...(/\n$/u.test(lines.at(-1) ?? "") ? [] : [newline]), text_];
	} else {
		let end = at + 1;
		while (end < lines.length) {
			const line = bare(lines[end] as string);
			if (line.trim() !== "" && !line.startsWith(`${indent} `) && !line.startsWith(`${indent}\t`)) break;
			end++;
		}
		out = [...lines.slice(0, at), text_, ...lines.slice(end)];
	}
	return MarkdownEdit.make({ offset: target.start, length: target.end - target.start, content: out.join("") });
};

/**
 * The one edit that sets `integrity.generated.body` and leaves every other byte
 * of the block (the `verified` slot, unknown keys, comments, quoting) as it was.
 * Inserts the whole block when absent or null; otherwise rewrites only the
 * `generated` slot's lines, or adds that slot first when missing. `text` is the
 * same BOM-stripped source the target was located in.
 *
 * @internal
 */
export const spliceIntegrityGenerated = (
	target: Exclude<IntegrityLocated, { readonly _tag: "unsupported" }>,
	text: string,
	body: string,
	newline: "\n" | "\r\n",
): MarkdownEdit =>
	spliceSlot(
		target,
		text,
		"generated",
		(indent, nl) => `${indent}generated:${nl}${indent}  body: ${formatDigest(body)}${nl}`,
		{ ...carried(target, "verified"), generated: { body } },
		newline,
	);

/**
 * The one edit that sets the `integrity.verified` binding and leaves every other
 * byte of the block (the `generated` slot, unknown keys, comments, quoting) as it
 * was; the mirror of {@link spliceIntegrityGenerated}. Inserts the whole block
 * when absent or null; otherwise rewrites only the `verified` slot's lines, or
 * appends that slot when missing. `text` is the same BOM-stripped source the
 * target was located in.
 *
 * @internal
 */
export const spliceIntegrityVerified = (
	target: Exclude<IntegrityLocated, { readonly _tag: "unsupported" }>,
	text: string,
	binding: { readonly by: string; readonly at: string; readonly content: string },
	newline: "\n" | "\r\n",
): MarkdownEdit =>
	spliceSlot(
		target,
		text,
		"verified",
		(indent, nl) =>
			`${indent}verified:${nl}${indent}  by: ${binding.by}${nl}${indent}  at: ${binding.at}${nl}${indent}  content: ${formatDigest(binding.content)}${nl}`,
		{ ...carried(target, "generated"), verified: binding },
		newline,
	);

/** A legacy `generated.body_sha256` line, or none. @internal */
export type LegacyBodyLocated =
	| { readonly _tag: "line"; readonly start: number; readonly end: number; readonly value: string }
	| { readonly _tag: "none" };

/**
 * Locate the legacy `generated.body_sha256` line (whole line plus terminator)
 * so it can be removed. `none` for every other shape.
 *
 * @internal
 */
export const locateLegacyBodySha256 = Effect.fn("okfit/verify/locateLegacyBodySha256")(function* (
	source: string,
): Generator<
	Effect.Effect<YamlDocument, YamlParseError> | Effect.Effect<ParsedTopLevelMapping, YamlParseError>,
	LegacyBodyLocated
> {
	const none = { _tag: "none" } as const;
	const parsed = yield* parseTopLevelMapping(source);
	if ("_tag" in parsed) return none;
	const { value, valueStart, contents } = parsed;
	if (contents.style === "flow") return none;
	const generated = contents.items.find(isKey("generated"))?.value;
	if (!(generated instanceof YamlMap) || generated.style === "flow") return none;
	const pair = generated.items.find(isKey("body_sha256"));
	const scalar = pair?.value;
	if (pair === undefined || !(scalar instanceof YamlScalar)) return none;
	if (scalar.style === "block-literal" || scalar.style === "block-folded") return none;
	const span = lineSpan(value, pair.key.offset, scalar.offset + scalar.length);
	if (span === undefined) return none;
	return {
		_tag: "line",
		start: valueStart + span.start,
		end: valueStart + span.end,
		value: String(scalar.value),
	} as const;
});

/** Delete exactly the located line and its terminator. @internal */
export const removeLine = (located: Extract<LegacyBodyLocated, { readonly _tag: "line" }>): MarkdownEdit =>
	MarkdownEdit.make({ offset: located.start, length: located.end - located.start, content: "" });
