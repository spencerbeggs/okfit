import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { FrontmatterSource } from "@effected/markdown";
import { YamlDocument, YamlMap, YamlScalar, YamlSeq } from "@effected/yaml";
import { Effect } from "effect";
import { detectNewline, documentNewline, locate, stripBom } from "../../src/verify/locate.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "verify");

/** The fixture's committed bytes, verbatim. */
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

/** `locate` over the BOM-stripped text, which is what `run.ts` feeds it. */
const locateFixture = (name: string) => locate(stripBom(read(name)).text);

describe("locate", () => {
	it.effect("classifies absent.md as absent and points at the end of the frontmatter value", () =>
		Effect.gen(function* () {
			const source = read("absent.md");
			const located = yield* locate(source);
			assert.strictEqual(located._tag, "absent");
			if (located._tag !== "absent") return;
			// One byte past the frontmatter value is the closing fence's `-`.
			assert.strictEqual(source.slice(located.insertAt, located.insertAt + 4), "---\n");
			assert.strictEqual(source.slice(located.insertAt - 15, located.insertAt), "status: stable\n");
		}),
	);

	it.effect("classifies block-list.md as a block sequence whose last item ends after a newline", () =>
		Effect.gen(function* () {
			const source = read("block-list.md");
			const located = yield* locate(source);
			assert.strictEqual(located._tag, "blockSeq");
			if (located._tag !== "blockSeq") return;
			assert.isTrue(located.afterNewline);
			assert.strictEqual(located.indent, "  ");
			assert.strictEqual(located.lastItemStyle, "block");
			assert.strictEqual(source.slice(located.insertAt, located.insertAt + 14), "status: stable");
		}),
	);

	it.effect(
		"classifies flow-items.md as a block sequence whose last item is flow-styled and ends before the newline",
		() =>
			Effect.gen(function* () {
				const source = read("flow-items.md");
				const located = yield* locate(source);
				assert.strictEqual(located._tag, "blockSeq");
				if (located._tag !== "blockSeq") return;
				assert.isFalse(located.afterNewline);
				assert.strictEqual(located.indent, "  ");
				assert.strictEqual(located.lastItemStyle, "flow");
				assert.strictEqual(source[located.insertAt], "\n");
				assert.strictEqual(source[located.insertAt - 1], "}");
			}),
	);

	it.effect("classifies flow-seq.md as a flow sequence and points at the closing bracket", () =>
		Effect.gen(function* () {
			const source = read("flow-seq.md");
			const located = yield* locate(source);
			assert.strictEqual(located._tag, "flowSeq");
			if (located._tag !== "flowSeq") return;
			assert.isFalse(located.empty);
			assert.strictEqual(source[located.insertAt], "]");
		}),
	);

	it.effect("classifies bare-flow-mapping.md as a bare flow mapping spanning from the colon to the closing brace", () =>
		Effect.gen(function* () {
			const source = read("bare-flow-mapping.md");
			const located = yield* locate(source);
			assert.strictEqual(located._tag, "bareMapping");
			if (located._tag !== "bareMapping") return;
			assert.strictEqual(located.style, "flow");
			assert.strictEqual(located.indent, "  ");
			assert.isFalse(located.endsWithNewline);
			// The span starts one byte past the key's colon, so the space after
			// `verified:` is consumed by the replacement (contract §12 note 2).
			assert.strictEqual(source.slice(located.start - 9, located.start), "verified:");
			assert.strictEqual(source[located.start], " ");
			assert.strictEqual(source[located.end - 1], "}");
			assert.strictEqual(located.original, "{ by: human:jsmith, at: 2026-01-02T00:00:00Z }");
		}),
	);

	it.effect("classifies bare-block-mapping.md as a bare block mapping spanning from the colon to the next key", () =>
		Effect.gen(function* () {
			const source = read("bare-block-mapping.md");
			const located = yield* locate(source);
			assert.strictEqual(located._tag, "bareMapping");
			if (located._tag !== "bareMapping") return;
			assert.strictEqual(located.style, "block");
			assert.strictEqual(located.indent, "  ");
			assert.isTrue(located.endsWithNewline);
			assert.strictEqual(source.slice(located.start - 9, located.start), "verified:");
			assert.strictEqual(located.original, "by: human:jsmith\n  at: 2026-01-02T00:00:00Z");
		}),
	);

	it.effect("classifies comments.md as a block sequence with both comments outside the span", () =>
		Effect.gen(function* () {
			const source = read("comments.md");
			const located = yield* locate(source);
			assert.strictEqual(located._tag, "blockSeq");
			if (located._tag !== "blockSeq") return;
			assert.isTrue(located.afterNewline);
			// The inline comment sits before the insertion point; the trailing
			// frontmatter comment sits after it, untouched by a zero-length edit.
			assert.isTrue(source.slice(0, located.insertAt).includes("# who verified first"));
			assert.isTrue(source.slice(located.insertAt).startsWith("# trailing frontmatter comment"));
		}),
	);

	it.effect(
		"pins the yaml 0.14.0 composer span for comments.md: the verified sequence's last item ends at the newline before the trailing comment, not inside it",
		() =>
			Effect.gen(function* () {
				const source = read("comments.md");
				const value = FrontmatterSource.split(source).frontmatter?.value;
				assert.isDefined(value);
				if (value === undefined) return;
				const document = yield* YamlDocument.parse(value);
				const contents = document.contents;
				assert.instanceOf(contents, YamlMap);
				if (!(contents instanceof YamlMap)) return;
				const pair = contents.items.find((item) => item.key instanceof YamlScalar && item.key.value === "verified");
				assert.isDefined(pair);
				if (pair === undefined) return;
				const node = pair.value;
				assert.instanceOf(node, YamlSeq);
				if (!(node instanceof YamlSeq)) return;
				const last = node.items[node.items.length - 1];
				assert.isDefined(last);
				if (last === undefined) return;
				// The span is trusted at face value (locate.ts, no more
				// `trimTrailingComment`): the last item's own trailing newline is
				// the final byte inside it (contract §12 note 1), so the boundary
				// lands directly on the floating comment rather than swallowing it.
				assert.isTrue(value.slice(last.offset + last.length).startsWith("# trailing frontmatter comment"));
			}),
	);

	it.effect("classifies crlf.md as a block sequence and reports CRLF as the document newline", () =>
		Effect.gen(function* () {
			const source = read("crlf.md");
			assert.strictEqual(documentNewline(source), "\r\n");
			assert.strictEqual(detectNewline(source), "\r\n");
			const located = yield* locate(source);
			assert.strictEqual(located._tag, "blockSeq");
			if (located._tag !== "blockSeq") return;
			assert.isTrue(located.afterNewline);
			assert.strictEqual(located.lastItemStyle, "block");
			assert.strictEqual(source.slice(located.insertAt, located.insertAt + 14), "status: stable");
		}),
	);

	it.effect("classifies bom.md as absent with offsets computed on the BOM-stripped text", () =>
		Effect.gen(function* () {
			const raw = read("bom.md");
			assert.strictEqual(raw.charCodeAt(0), 0xfeff);
			const { text, bom } = stripBom(raw);
			assert.strictEqual(bom, "﻿");
			assert.strictEqual(text, read("absent.md"));
			const located = yield* locate(text);
			assert.strictEqual(located._tag, "absent");
			if (located._tag !== "absent") return;
			assert.strictEqual(text.slice(located.insertAt, located.insertAt + 4), "---\n");
		}),
	);

	it.effect("classifies decision-style.md as absent", () =>
		Effect.gen(function* () {
			const source = read("decision-style.md");
			const located = yield* locate(source);
			assert.strictEqual(located._tag, "absent");
			if (located._tag !== "absent") return;
			assert.strictEqual(source.slice(located.insertAt - 15, located.insertAt), "status: stable\n");
		}),
	);

	it.effect("classifies alias.md as unsupported with shape alias (V-14)", () =>
		Effect.gen(function* () {
			const located = yield* locateFixture("alias.md");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "alias" });
		}),
	);

	it.effect("classifies merge-key.md as unsupported with shape merge-key (V-14)", () =>
		Effect.gen(function* () {
			const located = yield* locateFixture("merge-key.md");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "merge-key" });
		}),
	);

	it.effect("classifies a scalar verified value as unsupported with shape scalar", () =>
		Effect.gen(function* () {
			const located = yield* locate("---\ntype: Decision\nverified: null\n---\n\n# Scalar\n");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "scalar" });
		}),
	);
});
