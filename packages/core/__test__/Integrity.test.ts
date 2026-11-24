import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Effect, Option, Result, Schema } from "effect";
import { Digest, INTEGRITY_KEY, Integrity } from "../src/Integrity.js";
import { decodeConcept } from "../src/internal/frontmatter.js";

describe("Integrity", () => {
	it("accepts a 16-hex digest and rejects other lengths and cases", () => {
		assert.isTrue(Result.isSuccess(Schema.decodeUnknownResult(Digest)("9a1c3f07b2e8d415")));
		assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(Digest)("9A1C3F07B2E8D415")));
		assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(Digest)("9a1c3f07")));
		assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(Digest)("a".repeat(64))));
	});

	it("decodes both slots and either alone", () => {
		const both = Schema.decodeUnknownSync(Integrity)({
			generated: { body: "47fef58df84c6eb2" },
			verified: { by: "human:spencer", at: "2026-10-10T18:00:00Z", content: "9a1c3f07b2e8d415" },
		});
		assert.strictEqual(both.generated?.body, "47fef58df84c6eb2");
		assert.strictEqual(both.verified?.by, "human:spencer");
		assert.isUndefined(Schema.decodeUnknownSync(Integrity)({ generated: { body: "47fef58df84c6eb2" } }).verified);
	});

	it("names the top-level frontmatter key `integrity`", () => {
		assert.strictEqual(INTEGRITY_KEY, "integrity");
	});

	it.effect("decodes the family through the constant", () =>
		Effect.gen(function* () {
			const text = "---\ntype: Module\nintegrity:\n  generated:\n    body: 0123456789abcdef\n---\n\nBody\n";
			const document = yield* MarkdownDocument.parse(text, MarkdownParseOptions.make({ frontmatter: true }));
			const node = document.root.children[0] as Extract<
				(typeof document.root.children)[number],
				{ readonly type: "frontmatter" }
			>;
			const raw = { type: "Module", [INTEGRITY_KEY]: { generated: { body: "0123456789abcdef" } } };
			const result = decodeConcept(raw, { file: "m.md", text, node });
			const concept = Option.getOrThrow(result.concept);
			assert.strictEqual(concept.integrity?.generated?.body, "0123456789abcdef");
			assert.deepStrictEqual(result.diagnostics, []);
		}),
	);
});
