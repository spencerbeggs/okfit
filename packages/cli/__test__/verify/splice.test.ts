import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { FrontmatterSource, MarkdownEdit } from "@effected/markdown";
import { YamlDocument } from "@effected/yaml";
import { Verification } from "@okfit/core";
import { Effect, Schema } from "effect";
import { documentNewline, locate, stripBom } from "../../src/verify/locate.js";
import { splice } from "../../src/verify/splice.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "verify");
const read = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const readExpected = (name: string): string => readFileSync(join(FIXTURES, "expected", name), "utf8");

const ENTRY = { by: "human:spencer", at: "2026-09-07T00:00:00Z" } as const;

/**
 * The frontmatter's decoded-then-re-encoded `verified` list, or `[]` when
 * the key is absent. `YamlDocument.parse` is an `Effect.fn`, so this is an
 * Effect, not a plain call; the BOM is stripped first because
 * `FrontmatterSource.split` will not see a fence behind one.
 */
const verifiedOf = Effect.fn("verifiedOf")(function* (text: string) {
	const block = FrontmatterSource.split(stripBom(text).text).frontmatter;
	if (block === undefined) return [] as ReadonlyArray<{ readonly by: string; readonly at: string }>;
	const document = yield* YamlDocument.parse(block.value);
	const value = document.contents?.toValue() as Record<string, unknown> | undefined;
	const raw = value?.verified;
	if (raw === undefined) return [] as ReadonlyArray<{ readonly by: string; readonly at: string }>;
	return Schema.decodeUnknownSync(Verification.List)(raw).map((entry) => Schema.encodeSync(Verification)(entry));
});

/** Apply the one edit for `name` and return the original, the edit, and the result. */
const spliceFixture = (name: string) =>
	Effect.gen(function* () {
		const raw = read(name);
		const { text, bom } = stripBom(raw);
		const located = yield* locate(text);
		assert.notStrictEqual(located._tag, "unsupported");
		if (located._tag === "unsupported") throw new Error(`unexpected unsupported shape ${located.shape}`);
		const edit = splice(located, ENTRY, documentNewline(text));
		return { raw, text, bom, edit, applied: bom + MarkdownEdit.applyAll(text, [edit]) };
	});

const WRITABLE = [
	"absent.md",
	"block-list.md",
	"flow-items.md",
	"flow-seq.md",
	"bare-flow-mapping.md",
	"bare-block-mapping.md",
	"comments.md",
	"crlf.md",
	"bom.md",
	"decision-style.md",
] as const;

describe("splice", () => {
	for (const name of WRITABLE) {
		it.effect(
			`${name}: inserts exactly one entry, leaves every other byte alone, and decodes to one more Verification`,
			() =>
				Effect.gen(function* () {
					const { raw, text, bom, edit, applied } = yield* spliceFixture(name);

					// 1. Byte-exact output, asserted against a committed file.
					assert.strictEqual(applied, readExpected(name));

					// 2. Untouched-bytes property, proven from the edit triple —
					//    never by diffing after the fact.
					const body = applied.slice(bom.length);
					assert.strictEqual(body.slice(0, edit.offset), text.slice(0, edit.offset));
					assert.strictEqual(body.slice(edit.offset + edit.content.length), text.slice(edit.offset + edit.length));

					// 3. Decode-equivalence property: the old list plus the new
					//    entry, in that order. `Yaml.equals` is deliberately NOT
					//    used — it ignores comments, whitespace and key order.
					const before = yield* verifiedOf(raw);
					const after = yield* verifiedOf(applied);
					assert.deepStrictEqual(after, [...before, { by: ENTRY.by, at: ENTRY.at }]);
				}),
		);
	}

	it.effect("alias.md: refuses with shape alias and produces no edit (V-14)", () =>
		Effect.gen(function* () {
			const located = yield* locate(read("alias.md"));
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "alias" });
		}),
	);

	it.effect("merge-key.md: refuses with shape merge-key and produces no edit (V-14)", () =>
		Effect.gen(function* () {
			const located = yield* locate(read("merge-key.md"));
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "merge-key" });
		}),
	);

	it.effect("crlf.md: every inserted line terminator is CRLF and no bare LF appears in the output", () =>
		Effect.gen(function* () {
			const { applied, edit } = yield* spliceFixture("crlf.md");
			assert.isTrue(edit.content.includes("\r\n"));
			assert.strictEqual(applied.replace(/\r\n/g, "").indexOf("\n"), -1);
		}),
	);

	it.effect("bom.md: the output begins with U+FEFF and the remainder equals absent.md's own splice", () =>
		Effect.gen(function* () {
			const withBom = yield* spliceFixture("bom.md");
			const withoutBom = yield* spliceFixture("absent.md");
			assert.strictEqual(withBom.applied.charCodeAt(0), 0xfeff);
			assert.strictEqual(withBom.applied.slice(1), withoutBom.applied);
		}),
	);

	it.effect("comments.md: both comment lines survive verbatim", () =>
		Effect.gen(function* () {
			const { applied } = yield* spliceFixture("comments.md");
			assert.isTrue(applied.includes("  - by: human:jsmith # who verified first\n"));
			assert.isTrue(applied.includes("\n# trailing frontmatter comment\n"));
			assert.isTrue(applied.includes("\n# This concept exercises comment preservation.\n"));
		}),
	);

	it("decision-style.md's before-text still matches okf/decisions/cli-exit-codes.md's frontmatter", () => {
		const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
		const real = readFileSync(join(repoRoot, "okf", "decisions", "cli-exit-codes.md"), "utf8");
		const frontmatterOf = (text: string): string => text.slice(0, text.indexOf("\n---\n", 3) + 5);
		assert.strictEqual(frontmatterOf(read("decision-style.md")), frontmatterOf(real));
	});
});
