import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Effect } from "effect";
import { detectNewline, documentNewline, locateGenerated, stripBom } from "../../src/verify/locate.js";
import { spliceGenerated } from "../../src/verify/splice.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "sync", "generated");

/** The fixture's committed bytes, verbatim. */
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

/** `locateGenerated` over the BOM-stripped text, which is what `syncGenerated` feeds it. */
const locateFixture = (name: string) => locateGenerated(stripBom(read(name)).text);

const ENCODED_AT = "2026-09-07T20:49:08Z";

describe("locateGenerated", () => {
	it.effect("classifies only-by.md as insertAfterLastKey and points at the line after by", () =>
		Effect.gen(function* () {
			const source = read("only-by.md");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "insertAfterLastKey");
			if (located._tag !== "insertAfterLastKey") return;
			assert.strictEqual(located.indent, "  ");
			assert.strictEqual(source.slice(located.insertAt, located.insertAt + 14), "status: stable");
		}),
	);

	it.effect("classifies plain-at.md as replaceScalar spanning the plain at value with no quote", () =>
		Effect.gen(function* () {
			const source = read("plain-at.md");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "replaceScalar");
			if (located._tag !== "replaceScalar") return;
			assert.strictEqual(located.quote, "plain");
			assert.strictEqual(source.slice(located.start, located.end), "2026-01-02T00:00:00Z");
		}),
	);

	it.effect(
		"classifies quoted-at-single.md as replaceScalar spanning the single-quoted value including its quotes",
		() =>
			Effect.gen(function* () {
				const source = read("quoted-at-single.md");
				const located = yield* locateGenerated(source);
				assert.strictEqual(located._tag, "replaceScalar");
				if (located._tag !== "replaceScalar") return;
				assert.strictEqual(located.quote, "single-quoted");
				assert.strictEqual(source.slice(located.start, located.end), "'2026-01-02T00:00:00Z'");
			}),
	);

	it.effect(
		"classifies quoted-at-double.md as replaceScalar spanning the double-quoted value including its quotes",
		() =>
			Effect.gen(function* () {
				const source = read("quoted-at-double.md");
				const located = yield* locateGenerated(source);
				assert.strictEqual(located._tag, "replaceScalar");
				if (located._tag !== "replaceScalar") return;
				assert.strictEqual(located.quote, "double-quoted");
				assert.strictEqual(source.slice(located.start, located.end), '"2026-01-02T00:00:00Z"');
			}),
	);

	it.effect("classifies at-before-by.md as replaceScalar, finding at by key name rather than declaration order", () =>
		Effect.gen(function* () {
			const source = read("at-before-by.md");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "replaceScalar");
			if (located._tag !== "replaceScalar") return;
			assert.strictEqual(located.quote, "plain");
			assert.strictEqual(source.slice(located.start, located.end), "2026-01-02T00:00:00Z");
		}),
	);

	it.effect("classifies trailing-comment.md as insertAfterLastKey with the comment left outside the span", () =>
		Effect.gen(function* () {
			const source = read("trailing-comment.md");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "insertAfterLastKey");
			if (located._tag !== "insertAfterLastKey") return;
			assert.strictEqual(located.indent, "  ");
			assert.isTrue(source.slice(located.insertAt).startsWith("# trailing comment on generated"));
			assert.isTrue(source.slice(0, located.insertAt).includes("by: human:spencer"));
		}),
	);

	it.effect("classifies flow.md as unsupported with shape flow-mapping", () =>
		Effect.gen(function* () {
			const located = yield* locateFixture("flow.md");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "flow-mapping" });
		}),
	);

	it.effect(
		"classifies absent.md as unsupported when locateGenerated is called directly, since the caller-level generated-missing check runs first in practice",
		() =>
			Effect.gen(function* () {
				const located = yield* locateFixture("absent.md");
				assert.strictEqual(located._tag, "unsupported");
			}),
	);

	it.effect("classifies empty.md as unsupported with shape empty", () =>
		Effect.gen(function* () {
			const located = yield* locateFixture("empty.md");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "empty" });
		}),
	);

	it.effect("classifies crlf.md as insertAfterLastKey and reports CRLF as the document newline", () =>
		Effect.gen(function* () {
			const source = read("crlf.md");
			assert.strictEqual(documentNewline(source), "\r\n");
			assert.strictEqual(detectNewline(source), "\r\n");
			const located = yield* locateGenerated(source);
			assert.strictEqual(located._tag, "insertAfterLastKey");
			if (located._tag !== "insertAfterLastKey") return;
			assert.strictEqual(source.slice(located.insertAt, located.insertAt + 14), "status: stable");
		}),
	);

	it.effect("classifies bom.md as insertAfterLastKey with offsets computed on the BOM-stripped text", () =>
		Effect.gen(function* () {
			const raw = read("bom.md");
			assert.strictEqual(raw.charCodeAt(0), 0xfeff);
			const { text, bom } = stripBom(raw);
			assert.strictEqual(bom, "﻿");
			assert.strictEqual(text, read("only-by.md"));
			const located = yield* locateGenerated(text);
			assert.strictEqual(located._tag, "insertAfterLastKey");
		}),
	);

	it.effect("classifies at-not-scalar.md as unsupported with shape at-not-scalar", () =>
		Effect.gen(function* () {
			const located = yield* locateFixture("at-not-scalar.md");
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "at-not-scalar" });
		}),
	);
});

describe("spliceGenerated", () => {
	const WRITABLE = [
		"only-by.md",
		"plain-at.md",
		"quoted-at-single.md",
		"quoted-at-double.md",
		"at-before-by.md",
		"trailing-comment.md",
		"crlf.md",
		"bom.md",
	] as const;

	for (const name of WRITABLE) {
		it.effect(`${name}: produces exactly one edit that leaves every other byte alone`, () =>
			Effect.gen(function* () {
				const raw = read(name);
				const { text, bom } = stripBom(raw);
				const located = yield* locateGenerated(text);
				assert.notStrictEqual(located._tag, "unsupported");
				if (located._tag === "unsupported") throw new Error(`unexpected unsupported shape ${located.shape}`);
				const newline = documentNewline(text);
				const edit = spliceGenerated(located, ENCODED_AT, newline);
				const applied = bom + MarkdownEdit.applyAll(text, [edit]);
				const body = applied.slice(bom.length);
				assert.strictEqual(body.slice(0, edit.offset), text.slice(0, edit.offset));
				assert.strictEqual(body.slice(edit.offset + edit.content.length), text.slice(edit.offset + edit.length));
			}),
		);
	}

	it.effect("only-by.md: inserts at: 2026-09-07T20:49:08Z as its own line directly after by, before status", () =>
		Effect.gen(function* () {
			const source = read("only-by.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.strictEqual(
				applied,
				[
					"---",
					"type: Decision",
					"title: Generated with only by",
					"description: generated has by but no at yet.",
					"generated:",
					"  by: human:spencer",
					"  at: 2026-09-07T20:49:08Z",
					"status: stable",
					"---",
					"",
					"# Generated with only by",
					"",
				].join("\n"),
			);
		}),
	);

	it.effect("trailing-comment.md: the inserted at line lands above the comment, which survives verbatim", () =>
		Effect.gen(function* () {
			const source = read("trailing-comment.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.isTrue(applied.includes("  at: 2026-09-07T20:49:08Z\n# trailing comment on generated\n"));
		}),
	);

	it.effect("plain-at.md: replaces the plain scalar without introducing a quote", () =>
		Effect.gen(function* () {
			const source = read("plain-at.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "replaceScalar") throw new Error("expected replaceScalar");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.isTrue(applied.includes("  at: 2026-09-07T20:49:08Z\n"));
			assert.isFalse(applied.includes("2026-01-02T00:00:00Z"));
		}),
	);

	it.effect("quoted-at-single.md: replaces the value and keeps the single-quote style", () =>
		Effect.gen(function* () {
			const source = read("quoted-at-single.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "replaceScalar") throw new Error("expected replaceScalar");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.isTrue(applied.includes("  at: '2026-09-07T20:49:08Z'\n"));
		}),
	);

	it.effect("quoted-at-double.md: replaces the value and keeps the double-quote style", () =>
		Effect.gen(function* () {
			const source = read("quoted-at-double.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "replaceScalar") throw new Error("expected replaceScalar");
			const edit = spliceGenerated(located, ENCODED_AT, "\n");
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.isTrue(applied.includes('  at: "2026-09-07T20:49:08Z"\n'));
		}),
	);

	it.effect("crlf.md: every inserted line terminator is CRLF and no bare LF appears in the output", () =>
		Effect.gen(function* () {
			const source = read("crlf.md");
			const located = yield* locateGenerated(source);
			if (located._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const edit = spliceGenerated(located, ENCODED_AT, "\r\n");
			assert.isTrue(edit.content.includes("\r\n"));
			const applied = MarkdownEdit.applyAll(source, [edit]);
			assert.strictEqual(applied.replace(/\r\n/g, "").indexOf("\n"), -1);
		}),
	);

	it.effect("bom.md: the spliced output begins with U+FEFF and the remainder equals only-by.md's own splice", () =>
		Effect.gen(function* () {
			const withBomRaw = read("bom.md");
			const { text: withBomText, bom } = stripBom(withBomRaw);
			const withBomLocated = yield* locateGenerated(withBomText);
			if (withBomLocated._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const withBomEdit = spliceGenerated(withBomLocated, ENCODED_AT, "\n");
			const withBomApplied = bom + MarkdownEdit.applyAll(withBomText, [withBomEdit]);

			const withoutBomText = read("only-by.md");
			const withoutBomLocated = yield* locateGenerated(withoutBomText);
			if (withoutBomLocated._tag !== "insertAfterLastKey") throw new Error("expected insertAfterLastKey");
			const withoutBomEdit = spliceGenerated(withoutBomLocated, ENCODED_AT, "\n");
			const withoutBomApplied = MarkdownEdit.applyAll(withoutBomText, [withoutBomEdit]);

			assert.strictEqual(withBomApplied.charCodeAt(0), 0xfeff);
			assert.strictEqual(withBomApplied.slice(1), withoutBomApplied);
		}),
	);

	it.effect("flow.md, absent.md, empty.md, at-not-scalar.md: all refuse with unsupported and produce no edit", () =>
		Effect.gen(function* () {
			for (const name of ["flow.md", "absent.md", "empty.md", "at-not-scalar.md"] as const) {
				const located = yield* locateFixture(name);
				assert.strictEqual(located._tag, "unsupported");
			}
		}),
	);
});
