import { assert, describe, it } from "@effect/vitest";
import type { ConceptId } from "@okfit/core";
import { Bundle, Graph } from "@okfit/core";
import { Effect, Option } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import { conceptAtPath, definitionOf, edgeAt, offsetOf } from "../../src/features/locate.js";
import { testPlatform } from "../utils/platform.js";
import { makeTempBundle } from "../utils/tempBundle.js";

const platform = testPlatform();

describe("offsetOf", () => {
	it("maps a position on the first line to its offset (positive control)", () => {
		assert.strictEqual(offsetOf("abc\ndef", { line: 0, character: 2 }), 2);
	});

	it("maps a position after an LF line break", () => {
		assert.strictEqual(offsetOf("abc\ndef", { line: 1, character: 1 }), 5);
	});

	it("counts a CRLF line break as two code units, same as core's `lineCharacter`", () => {
		assert.strictEqual(offsetOf("abc\r\ndef", { line: 1, character: 0 }), 5);
	});

	it("counts a UTF-16 code unit for a surrogate pair on a preceding line and another inside the target line before the position -- a code-point counter would land short on both", () => {
		// Line 0 carries an astral character (U+1F600, a surrogate pair: two UTF-16 code units) so the offset that
		// crosses into line 1 only comes out right if the newline search itself counts code units, not code points.
		const line0 = "\u{1F600}ab";
		// Line 1 also carries an astral character before the requested position, so the within-line count must
		// also treat it as two code units, not one.
		const line1Prefix = "c\u{1F600}";
		const text = `${line0}\n${line1Prefix}de`;
		// Independent of `offsetOf`: JS string `.length` already counts UTF-16 code units, which is exactly the
		// unit LSP positions use, so this arithmetic is the ground truth a correct implementation must match.
		const expected = line0.length + 1 /* the LF */ + line1Prefix.length;
		assert.strictEqual(offsetOf(text, { line: 1, character: line1Prefix.length }), expected);
	});

	it("clamps a character past the end of its line to that line's end, not the next line's start (in-range control first)", () => {
		assert.strictEqual(offsetOf("abc\ndef", { line: 0, character: 3 }), 3);
		assert.strictEqual(offsetOf("abc\ndef", { line: 0, character: 5 }), 3);
		assert.strictEqual(offsetOf("abc\r\ndef", { line: 0, character: 9 }), 3);
		assert.strictEqual(offsetOf("abc\ndef", { line: 1, character: 99 }), 7);
	});

	it("a lone CR (no following LF) still counts as one line break", () => {
		assert.strictEqual(offsetOf("abc\rdef", { line: 1, character: 0 }), 4);
	});
});

const targetContent = "---\ntype: Module\ntitle: Target\nresource: target.md\n---\n\n# Target\n";
/**
 * CRLF throughout, with a surrogate-pair astral character on a line
 * preceding the link AND another inside the link's own line before the
 * link itself, so the link's offset only comes out right if `edgeAt`'s
 * underlying position mapping counts UTF-16 code units across a line break
 * and within a line, not code points. Built from named segments so the
 * expected offset below is computed independently of the graph's own
 * output (each segment's `.length` is JS's own UTF-16 code-unit count, the
 * unit LSP positions use).
 */
const B_FRONTMATTER = "---\r\ntype: Module\r\ntitle: B\r\nresource: b.md\r\n---\r\n";
const B_BLANK_1 = "\r\n";
const B_HEADING = "# \u{1F600}B\r\n"; // astral character on the line preceding the link's own line
const B_BLANK_2 = "\r\n";
const B_LINK_PREFIX = "Emoji \u{1F600} leads to "; // astral character before the link, same line
const B_LINK_TEXT = "[Target](target.md)";
const B_LINK_SUFFIX = " here.\r\n";
const bContent = B_FRONTMATTER + B_BLANK_1 + B_HEADING + B_BLANK_2 + B_LINK_PREFIX + B_LINK_TEXT + B_LINK_SUFFIX;
/** Independent of the parser: plain UTF-16 code-unit arithmetic over the segments above. */
const expectedLinkOffset =
	B_FRONTMATTER.length + B_BLANK_1.length + B_HEADING.length + B_BLANK_2.length + B_LINK_PREFIX.length;
const expectedLinkLength = B_LINK_TEXT.length;

describe("edgeAt", () => {
	it.effect(
		"finds the edge whose span contains an offset computed by hand, independent of the parser, inside a CRLF source with multi-byte characters both on a preceding line and before the link on its own line; a one-before/one-after offset misses (positive control above)",
		() =>
			Effect.gen(function* () {
				const { root } = yield* makeTempBundle({ "b.md": bContent, "target.md": targetContent });
				const bundle = yield* Bundle.load({ root });
				const graph = Graph.fromBundle(bundle);
				const edges = graph.edges.filter((link) => link.from === "b" && link.to === "target");
				assert.strictEqual(edges.length, 1);
				const position = edges[0]!.data.position!;
				assert.strictEqual(position.offset, expectedLinkOffset);
				assert.strictEqual(position.length, expectedLinkLength);

				const atStart = edgeAt(graph, "b.md", expectedLinkOffset);
				assert.isTrue(Option.isSome(atStart));
				assert.strictEqual(Option.getOrThrow(atStart).to, "target");

				const atLastChar = edgeAt(graph, "b.md", expectedLinkOffset + expectedLinkLength - 1);
				assert.isTrue(Option.isSome(atLastChar));

				const justBefore = edgeAt(graph, "b.md", expectedLinkOffset - 1);
				assert.isTrue(Option.isNone(justBefore));

				const justAfter = edgeAt(graph, "b.md", expectedLinkOffset + expectedLinkLength);
				assert.isTrue(Option.isNone(justAfter));
			}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("None for a path that is not a concept id", () =>
		Effect.gen(function* () {
			const { root } = yield* makeTempBundle({ "b.md": bContent, "target.md": targetContent });
			const bundle = yield* Bundle.load({ root });
			const graph = Graph.fromBundle(bundle);
			assert.isTrue(Option.isNone(edgeAt(graph, "index.md", 0)));
		}).pipe(Effect.provide(platform), Effect.scoped),
	);
});

describe("definitionOf", () => {
	it.effect("a concept with a depth-1 heading points at the heading's own range", () =>
		Effect.gen(function* () {
			const { root } = yield* makeTempBundle({ "b.md": bContent, "target.md": targetContent });
			const bundle = yield* Bundle.load({ root });
			const location = definitionOf(bundle, "target" as ConceptId);
			assert.isTrue(Option.isSome(location));
			const { uri, range } = Option.getOrThrow(location);
			assert.strictEqual(uri, pathToUri(`${root}/target.md`));
			const concept = bundle.concepts.get("target" as ConceptId)!;
			assert.isTrue(concept.document.source.slice(concept.document.source.indexOf("# Target")).startsWith("# Target"));
			assert.strictEqual(range.start.line, 6);
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("a concept with no heading falls back to its frontmatter block (no heading is the one thing wrong)", () =>
		Effect.gen(function* () {
			const noHeading = "---\ntype: Module\ntitle: C\nresource: c.md\n---\n\nNo heading here, just text.\n";
			const { root } = yield* makeTempBundle({ "c.md": noHeading });
			const bundle = yield* Bundle.load({ root });
			const location = definitionOf(bundle, "c" as ConceptId);
			assert.isTrue(Option.isSome(location));
			const { range } = Option.getOrThrow(location);
			assert.strictEqual(range.start.line, 0);
			assert.strictEqual(range.start.character, 0);
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("None for a concept id not in the bundle", () =>
		Effect.gen(function* () {
			const { root } = yield* makeTempBundle({ "c.md": targetContent.replace("Target", "C") });
			const bundle = yield* Bundle.load({ root });
			assert.isTrue(Option.isNone(definitionOf(bundle, "nope" as ConceptId)));
		}).pipe(Effect.provide(platform), Effect.scoped),
	);
});

describe("conceptAtPath", () => {
	it.effect("delegates to the engine's conceptFor", () =>
		Effect.gen(function* () {
			const { root } = yield* makeTempBundle({ "b.md": bContent, "target.md": targetContent });
			const bundle = yield* Bundle.load({ root });
			const found = conceptAtPath(bundle, `${root}/b.md`);
			assert.isTrue(Option.isSome(found));
			assert.strictEqual(Option.getOrThrow(found).id, "b");
			assert.isTrue(Option.isNone(conceptAtPath(bundle, "/elsewhere/b.md")));
		}).pipe(Effect.provide(platform), Effect.scoped),
	);
});
