import { MarkdownEdit } from "@effected/markdown";
import type { YamlDocument, YamlNode, YamlParseError } from "@effected/yaml";
import { YamlAlias, YamlMap, YamlScalar, YamlSeq } from "@effected/yaml";
import { Integrity } from "@okfit/core";
import { Effect, Option, Schema } from "effect";
import type { ParsedTopLevelMapping } from "./locate.js";
import { hasMergeKey, parseTopLevelMapping } from "./locate.js";

/**
 * One item of a block-style `integrity` mapping: its key as parsed (so `'verified'`
 * and `verified` are the same slot) and the whole-file span of its lines, from the
 * start of the key's line through the terminator of the value's last line.
 *
 * @internal
 */
export interface IntegritySlot {
	readonly key: string;
	readonly start: number;
	readonly end: number;
}

/**
 * Where okfit's own top-level `integrity` block lives (whole-file offsets into
 * the BOM-stripped source). `absent` is the end of the frontmatter value;
 * `replace` spans the key's line through the terminator of its last nested
 * line, and `current` is the block decoded through the `Integrity` schema
 * (`undefined` when malformed or null). `slots` are the parsed items with their
 * spans and `indent` their key column, so a slot edit never re-derives the
 * layout from line text; `boundBy` is `verified.by` read from the parsed tree,
 * present even when the block does not decode as a whole. `bareKey` marks a
 * key line with no value text (`integrity:`, optionally with a comment), which
 * a slot can be added under without rewriting the line. A block mapping whose
 * items cannot all be mapped to line spans (a complex key, an explicit `?`
 * key, a key sharing a line) is `unsupported` (`integrity-layout`).
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
			readonly slots: ReadonlyArray<IntegritySlot>;
			readonly indent: string;
			readonly boundBy: string | undefined;
			readonly bareKey: boolean;
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

	const slots: Array<IntegritySlot> = [];
	let indent = "  ";
	if (node instanceof YamlMap) {
		for (const [index, item] of node.items.entries()) {
			if (!(item.key instanceof YamlScalar)) return { _tag: "unsupported", shape: "integrity-layout" } as const;
			let itemTail = item.value !== null ? item.value.offset + item.value.length : item.key.offset + item.key.length;
			// A nested block map's span runs on into the next line's indentation; stop at its terminator.
			while (itemTail > item.key.offset && (value[itemTail - 1] === " " || value[itemTail - 1] === "\t")) itemTail--;
			const itemSpan = lineSpan(value, item.key.offset, itemTail);
			const previous = slots.at(-1);
			if (itemSpan === undefined || (previous !== undefined && valueStart + itemSpan.start < previous.end)) {
				return { _tag: "unsupported", shape: "integrity-layout" } as const;
			}
			const column = value.slice(itemSpan.start, item.key.offset);
			if (index === 0) indent = column;
			else if (column !== indent) return { _tag: "unsupported", shape: "integrity-layout" } as const;
			slots.push({ key: String(item.key.value), start: valueStart + itemSpan.start, end: valueStart + itemSpan.end });
		}
	}
	const raw = node instanceof YamlMap ? rawValue(node, value) : undefined;
	const current = raw === undefined ? undefined : Option.getOrUndefined(decodeIntegrity(raw));
	const verifiedRaw = (raw as { readonly verified?: unknown } | undefined)?.verified;
	const boundByRaw =
		verifiedRaw !== null && typeof verifiedRaw === "object" ? (verifiedRaw as { readonly by?: unknown }).by : undefined;
	const bareKey = node === null || (node instanceof YamlScalar && node.length === 0);
	return {
		_tag: "replace",
		start: valueStart + span.start,
		end: valueStart + span.end,
		current,
		slots,
		indent,
		boundBy: typeof boundByRaw === "string" ? boundByRaw : undefined,
		bareKey,
	} as const;
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

/**
 * Rewrite only one slot of the located `integrity` block, driven by the parsed
 * item spans: every other byte (the key line and its comment, the other slot,
 * unknown keys, comments between items, quoting) is copied as it was. A
 * present slot (however its key is quoted) is replaced in place; a missing one
 * is added first (`generated`) or last (`verified`), matching
 * {@link renderIntegrity}'s order. Only an absent block, or one with no items
 * and value text (`integrity: ~`), is written whole -- there is nothing in it
 * to lose. No edit here is a zero-length insert at the end of the block, so it
 * cannot collide with a key appended at the end of the frontmatter.
 */
const spliceSlot = (
	target: Exclude<IntegrityLocated, { readonly _tag: "unsupported" }>,
	text: string,
	slot: "generated" | "verified",
	slotLines: (indent: string, newline: "\n" | "\r\n") => string,
	whole: IntegrityFields,
	newline: "\n" | "\r\n",
): MarkdownEdit => {
	if (target._tag === "absent") return spliceIntegrity(target, whole, newline);
	const terminated = (start: number, end: number) => {
		const lines = text.slice(start, end);
		return lines.endsWith("\n") ? lines : `${lines}${newline}`;
	};
	if (target.slots.length === 0) {
		if (!target.bareKey) return spliceIntegrity(target, whole, newline);
		return MarkdownEdit.make({
			offset: target.start,
			length: target.end - target.start,
			content: terminated(target.start, target.end) + slotLines(target.indent, newline),
		});
	}
	const lines = slotLines(target.indent, newline);
	const found = target.slots.find((entry) => entry.key === slot);
	if (found !== undefined)
		return MarkdownEdit.make({ offset: found.start, length: found.end - found.start, content: lines });
	if (slot === "generated") {
		const first = target.slots[0] as IntegritySlot;
		return MarkdownEdit.make({ offset: first.start, length: 0, content: lines });
	}
	const last = target.slots.at(-1) as IntegritySlot;
	return MarkdownEdit.make({
		offset: last.start,
		length: last.end - last.start,
		content: terminated(last.start, last.end) + lines,
	});
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
		{ generated: { body } },
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
		{ verified: binding },
		newline,
	);

/** What {@link removeIntegrityVerified} decided. @internal */
export type IntegrityVerifiedRemoval =
	| { readonly _tag: "none" }
	| { readonly _tag: "edit"; readonly edit: MarkdownEdit }
	| { readonly _tag: "unsupported"; readonly shape: string };

/**
 * The one edit that removes the `integrity.verified` slot and nothing else:
 * only that parsed item's lines go (however its key is quoted); every other
 * byte of the block (the `generated` slot, unknown keys, comments, quoting)
 * stays. When it is the block's only item, the whole block goes instead.
 * `none` when the block is absent; fails closed (`unsupported`) when the
 * parsed block has no `verified` item, never falling back to a whole-block
 * rewrite. `text` is unused (the spans come from {@link locateIntegrity}) and
 * kept for call-site symmetry with the splice functions.
 *
 * @internal
 */
export const removeIntegrityVerified = (
	target: Exclude<IntegrityLocated, { readonly _tag: "unsupported" }>,
	_text: string,
): IntegrityVerifiedRemoval => {
	if (target._tag === "absent") return { _tag: "none" };
	const found = target.slots.find((entry) => entry.key === "verified");
	if (found === undefined) return { _tag: "unsupported", shape: "integrity-layout" };
	const [offset, end] = target.slots.length === 1 ? [target.start, target.end] : [found.start, found.end];
	return { _tag: "edit", edit: MarkdownEdit.make({ offset, length: end - offset, content: "" }) };
};

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
