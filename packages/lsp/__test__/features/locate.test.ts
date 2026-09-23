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

	it("counts an astral character earlier on the line as two UTF-16 code units (the surrogate pair), matching how the LSP protocol itself counts characters", () => {
		// U+1F600 GRINNING FACE is a surrogate pair: two UTF-16 code units.
		assert.strictEqual(offsetOf("\u{1F600}abc", { line: 0, character: 2 }), 2);
	});

	it("a lone CR (no following LF) still counts as one line break", () => {
		assert.strictEqual(offsetOf("abc\rdef", { line: 1, character: 0 }), 4);
	});
});

const targetContent = "---\ntype: Module\ntitle: Target\nresource: target.md\n---\n\n# Target\n";
/** CRLF throughout, plus an astral character (a surrogate pair) on the line before the link, so the link's own
 * offset only comes out right if `edgeAt`'s underlying position mapping counts UTF-16 code units, not code points. */
const bContent =
	"---\r\ntype: Module\r\ntitle: B\r\nresource: b.md\r\n---\r\n\r\n# B\r\n\r\nEmoji \u{1F600} leads to [Target](target.md) here.\r\n";

describe("edgeAt", () => {
	it.effect(
		"finds the edge whose span contains an offset inside a CRLF source with a multi-byte character earlier on the same line; a one-before/one-after offset misses (positive control above)",
		() =>
			Effect.gen(function* () {
				const { root } = yield* makeTempBundle({ "b.md": bContent, "target.md": targetContent });
				const bundle = yield* Bundle.load({ root });
				const graph = Graph.fromBundle(bundle);
				const edges = graph.edges.filter((link) => link.from === "b" && link.to === "target");
				assert.strictEqual(edges.length, 1);
				const position = edges[0]!.data.position!;

				const atStart = edgeAt(graph, "b.md", position.offset);
				assert.isTrue(Option.isSome(atStart));
				assert.strictEqual(Option.getOrThrow(atStart).to, "target");

				const atLastChar = edgeAt(graph, "b.md", position.offset + position.length - 1);
				assert.isTrue(Option.isSome(atLastChar));

				const justBefore = edgeAt(graph, "b.md", position.offset - 1);
				assert.isTrue(Option.isNone(justBefore));

				const justAfter = edgeAt(graph, "b.md", position.offset + position.length);
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
