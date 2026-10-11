import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Effect } from "effect";
import type { IntegrityFields } from "../../src/verify/integrity.js";
import {
	locateIntegrity,
	locateLegacyBodySha256,
	removeLine,
	renderIntegrity,
	spliceIntegrity,
} from "../../src/verify/integrity.js";
import { documentNewline, stripBom } from "../../src/verify/locate.js";

const DIR = join(import.meta.dirname, "..", "fixtures", "verify", "integrity");
const read = (name: string): string => readFileSync(join(DIR, name), "utf8");
const expected = (name: string): string => readFileSync(join(DIR, "expected", name), "utf8");

const GENERATED = { body: "47fef58df84c6eb2" } as const;
const VERIFIED = { by: "human:spencer", at: "2026-10-10T18:00:00Z", content: "9a1c3f07b2e8d415" } as const;

const apply = (name: string, fields: IntegrityFields) =>
	Effect.gen(function* () {
		const { text, bom } = stripBom(read(name));
		const located = yield* locateIntegrity(text);
		if (located._tag === "unsupported") throw new Error(`unsupported ${located.shape}`);
		return bom + MarkdownEdit.applyAll(text, [spliceIntegrity(located, fields, documentNewline(text))]);
	});

describe("integrity splice", () => {
	it.effect("inserts at the end of the frontmatter when absent (LF)", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* apply("absent.md", { generated: GENERATED }), expected("absent.md"));
		}),
	);
	it.effect("inserts with CRLF and a BOM", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* apply("absent-crlf-bom.md", { generated: GENERATED }), expected("absent-crlf-bom.md"));
		}),
	);
	it.effect("replaces a block holding only generated", () =>
		Effect.gen(function* () {
			const { text } = stripBom(read("replace-generated-only.md"));
			const located = yield* locateIntegrity(text);
			assert.strictEqual(located._tag, "replace");
			if (located._tag === "replace") {
				assert.deepStrictEqual(located.current?.generated?.body, "0000000000000000");
				assert.isUndefined(located.current?.verified);
			}
			assert.strictEqual(
				yield* apply("replace-generated-only.md", { generated: GENERATED, verified: VERIFIED }),
				expected("replace-generated-only.md"),
			);
		}),
	);
	it.effect("replaces a block holding both slots", () =>
		Effect.gen(function* () {
			const { text } = stripBom(read("replace-both.md"));
			const located = yield* locateIntegrity(text);
			if (located._tag === "replace") assert.strictEqual(located.current?.verified?.by, "human:old");
			else assert.fail("expected replace");
			assert.strictEqual(
				yield* apply("replace-both.md", { generated: GENERATED, verified: VERIFIED }),
				expected("replace-both.md"),
			);
		}),
	);
	it.effect("replaces a malformed block, reporting current as undefined", () =>
		Effect.gen(function* () {
			const { text } = stripBom(read("replace-malformed.md"));
			const located = yield* locateIntegrity(text);
			if (located._tag === "replace") assert.isUndefined(located.current);
			else assert.fail("expected replace");
			assert.strictEqual(
				yield* apply("replace-malformed.md", { generated: GENERATED }),
				expected("replace-malformed.md"),
			);
		}),
	);
	it.effect("deletes the block when no slot remains", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* apply("delete.md", {}), expected("delete.md"));
		}),
	);
	it.effect("reports an alias as unsupported", () =>
		Effect.gen(function* () {
			const located = yield* locateIntegrity(read("alias.md"));
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "alias" });
		}),
	);
	it.effect("reports a flow mapping as unsupported", () =>
		Effect.gen(function* () {
			const located = yield* locateIntegrity(read("flow-mapping.md"));
			assert.deepStrictEqual(located, { _tag: "unsupported", shape: "flow-mapping" });
		}),
	);
	it("renders nothing for no slots and canonical YAML otherwise", () => {
		assert.strictEqual(renderIntegrity({}, "\n"), "");
		assert.strictEqual(
			renderIntegrity({ verified: VERIFIED }, "\r\n"),
			"integrity:\r\n  verified:\r\n    by: human:spencer\r\n    at: 2026-10-10T18:00:00Z\r\n    content: 9a1c3f07b2e8d415\r\n",
		);
	});
});

describe("legacy body_sha256", () => {
	for (const name of ["legacy-last.md", "legacy-middle.md"]) {
		it.effect(`${name}: locates the line and removeLine drops exactly it`, () =>
			Effect.gen(function* () {
				const text = read(name);
				const located = yield* locateLegacyBodySha256(text);
				if (located._tag !== "line") return assert.fail("expected line");
				assert.strictEqual(located.value, "abc");
				assert.strictEqual(text.slice(located.start, located.end), "  body_sha256: abc\n");
				assert.strictEqual(MarkdownEdit.applyAll(text, [removeLine(located)]), expected(name));
			}),
		);
	}
	it.effect("reports none when body_sha256 is absent", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* locateLegacyBodySha256(read("legacy-none.md")), { _tag: "none" });
		}),
	);
});
