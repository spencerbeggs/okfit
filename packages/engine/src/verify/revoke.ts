import type { YamlDocument, YamlParseError } from "@effected/yaml";
import { YamlAlias, YamlMap, YamlScalar, YamlSeq } from "@effected/yaml";
import { Effect } from "effect";
import type { ParsedTopLevelMapping } from "./locate.js";
import { hasMergeKey, parseTopLevelMapping } from "./locate.js";

/**
 * Where `actor`'s `verified` entries are, as whole-file spans of the
 * BOM-stripped source. `removals` are ascending, non-overlapping, each a whole
 * line range with its terminator. When every entry is the actor's
 * (`removesAll`), `removals` is the single span of the `verified:` key line
 * through the end of its block, so applying them leaves no empty key behind;
 * `keyLine` is that key's own line either way. `none` covers an absent key and
 * a key with no entry by the actor; `unsupported` a shape that cannot be cut
 * line-wise (flow sequence, alias, merge key, scalar, empty).
 *
 * @internal
 */
export type VerifiedEntriesLocated =
	| {
			readonly _tag: "entries";
			readonly removals: ReadonlyArray<{ readonly start: number; readonly end: number }>;
			readonly removesAll: boolean;
			readonly keyLine: { readonly start: number; readonly end: number };
	  }
	| { readonly _tag: "none" }
	| { readonly _tag: "unsupported"; readonly shape: string };

const byActor =
	(actor: string) =>
	(map: YamlMap): boolean =>
		map.items.some(
			(entry) =>
				entry.key instanceof YamlScalar &&
				entry.key.value === "by" &&
				entry.value instanceof YamlScalar &&
				entry.value.value === actor,
		);

/**
 * Locate every top-level `verified` entry whose `by` is `actor`. See
 * {@link VerifiedEntriesLocated}. Fails only when the frontmatter YAML is
 * fatally unparseable.
 *
 * @internal
 */
export const locateVerifiedEntries = Effect.fn("okfit/verify/locateVerifiedEntries")(function* (
	source: string,
	actor: string,
): Generator<
	Effect.Effect<YamlDocument, YamlParseError> | Effect.Effect<ParsedTopLevelMapping, YamlParseError>,
	VerifiedEntriesLocated
> {
	const parsed = yield* parseTopLevelMapping(source);
	if ("_tag" in parsed) return parsed;
	const { value, valueStart, contents } = parsed;
	if (contents.style === "flow") return { _tag: "unsupported", shape: "flow-document" } as const;

	const pair = contents.items.find((item) => item.key instanceof YamlScalar && item.key.value === "verified");
	if (pair === undefined) return { _tag: "none" } as const;

	const node = pair.value;
	if (node === null) return { _tag: "unsupported", shape: "empty" } as const;
	if (node instanceof YamlAlias) return { _tag: "unsupported", shape: "alias" } as const;
	if (hasMergeKey(node)) return { _tag: "unsupported", shape: "merge-key" } as const;
	if (node instanceof YamlScalar) return { _tag: "unsupported", shape: "scalar" } as const;

	const lineStart = (offset: number) => value.lastIndexOf("\n", offset - 1) + 1;
	/** Just past the terminator of the line holding the node end `end`. */
	const lineEnd = (end: number): number => {
		// A block item's span can run on into the next line's indentation; stop at that line's start.
		const before = value.lastIndexOf("\n", end - 1);
		if (before !== -1 && /^[ \t]*$/u.test(value.slice(before + 1, end))) return before + 1;
		const nl = value.indexOf("\n", end);
		return nl === -1 ? value.length : nl + 1;
	};
	const keyStart = lineStart(pair.key.offset);
	if (value.slice(keyStart, pair.key.offset).trim() !== "") {
		return { _tag: "unsupported", shape: "not-a-mapping" } as const;
	}
	const keyLine = { start: valueStart + keyStart, end: valueStart + lineEnd(pair.key.offset + pair.key.length) };

	const whole = (tail: number) =>
		({
			_tag: "entries",
			removals: [{ start: keyLine.start, end: valueStart + lineEnd(tail) }],
			removesAll: true,
			keyLine,
		}) as const;

	// A bare mapping is one entry.
	if (node instanceof YamlMap) {
		return byActor(actor)(node) ? whole(node.offset + node.length) : ({ _tag: "none" } as const);
	}
	if (!(node instanceof YamlSeq)) return { _tag: "unsupported", shape: "not-a-mapping" } as const;
	if (node.style === "flow") return { _tag: "unsupported", shape: "flow-sequence" } as const;

	const matching = node.items.filter((item): item is YamlMap => item instanceof YamlMap && byActor(actor)(item));
	if (matching.length === 0) return { _tag: "none" } as const;
	const last = node.items[node.items.length - 1];
	if (matching.length === node.items.length && last !== undefined) return whole(last.offset + last.length);

	const removals: Array<{ start: number; end: number }> = [];
	for (const item of matching) {
		const start = lineStart(item.offset);
		// The item must begin its line after its dash (`  - `); anything else is not cut line-wise.
		if (!/^ *- *$/u.test(value.slice(start, item.offset))) {
			return { _tag: "unsupported", shape: "inline-item" } as const;
		}
		removals.push({ start: valueStart + start, end: valueStart + lineEnd(item.offset + item.length) });
	}
	return { _tag: "entries", removals, removesAll: false, keyLine } as const;
});
