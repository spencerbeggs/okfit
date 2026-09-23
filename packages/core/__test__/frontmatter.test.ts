import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Effect, Option } from "effect";
import { decodeConcept, frontmatterPathRange } from "../src/internal/frontmatter.js";

const OPTIONS = MarkdownParseOptions.make({ frontmatter: true });

describe("internal/frontmatter", () => {
	it.effect("TypeMissing yields a type-missing diagnostic with no range and no concept", () =>
		Effect.gen(function* () {
			const text = "---\ntitle: no type\n---\n\nBody\n";
			const document = yield* MarkdownDocument.parse(text, OPTIONS);
			const node = document.root.children[0] as Extract<
				(typeof document.root.children)[number],
				{ readonly type: "frontmatter" }
			>;
			const result = decodeConcept({ title: "no type" }, { file: "no-type.md", text, node });
			assert.isTrue(Option.isNone(result.concept));
			assert.deepStrictEqual(
				result.diagnostics.map((d) => [d.code, d.range]),
				[["type-missing", undefined]],
			);
		}),
	);
	it.effect("a failing family reports family-invalid at the yaml-shifted, D-14 file offset", () =>
		Effect.gen(function* () {
			const text =
				'---\ntype: Module\ngenerated: { by: reference_agent/gemini-2.5-pro, at: "2026-06-30T14:00:00" }\n---\n\nBody\n';
			const document = yield* MarkdownDocument.parse(text, OPTIONS);
			const node = document.root.children[0] as Extract<
				(typeof document.root.children)[number],
				{ readonly type: "frontmatter" }
			>;
			const raw = { type: "Module", generated: { by: "reference_agent/gemini-2.5-pro", at: "2026-06-30T14:00:00" } };
			const result = decodeConcept(raw, { file: "widget.md", text, node });
			assert.isTrue(Option.isSome(result.concept));
			assert.deepStrictEqual(
				result.diagnostics.map((d) => d.code),
				["family-invalid"],
			);
			assert.isDefined(result.diagnostics[0]?.range);
			assert.isAbove(result.diagnostics[0]!.range!.offset, text.indexOf("generated:"));
		}),
	);

	describe("frontmatterPathRange", () => {
		it.effect("resolves a top-level key's own range", () =>
			Effect.gen(function* () {
				const text = "---\ntype: Module\ntitle: Widget\n---\n\n# Widget\n";
				const document = yield* MarkdownDocument.parse(text, OPTIONS);
				const range = frontmatterPathRange(document, ["type"]);
				assert.isDefined(range);
				assert.strictEqual(text.slice(range!.offset, range!.offset + range!.length), "Module");
			}),
		);

		it.effect("resolves a nested key's own range", () =>
			Effect.gen(function* () {
				const text = "---\ntype: Module\ngenerated:\n  by: human:ada\n---\n\n# Widget\n";
				const document = yield* MarkdownDocument.parse(text, OPTIONS);
				const range = frontmatterPathRange(document, ["generated", "by"]);
				assert.isDefined(range);
				assert.strictEqual(text.slice(range!.offset, range!.offset + range!.length), "human:ada");
			}),
		);

		it.effect("resolves an array index's own range", () =>
			Effect.gen(function* () {
				const text = "---\ntype: Module\nverified:\n  - by: human:ada\n    at: 2025-01-01T00:00:00Z\n---\n\n# Widget\n";
				const document = yield* MarkdownDocument.parse(text, OPTIONS);
				const range = frontmatterPathRange(document, ["verified", 0, "by"]);
				assert.isDefined(range);
				assert.strictEqual(text.slice(range!.offset, range!.offset + range!.length), "human:ada");
			}),
		);

		it.effect(
			"falls back to the frontmatter block when the leaf is missing, unlike a present leaf (positive control)",
			() =>
				Effect.gen(function* () {
					const text = "---\ntype: Module\ntitle: Widget\n---\n\n# Widget\n";
					const document = yield* MarkdownDocument.parse(text, OPTIONS);
					const block = frontmatterPathRange(document, []);
					const missing = frontmatterPathRange(document, ["nope"]);
					assert.deepStrictEqual(missing, block);
					const present = frontmatterPathRange(document, ["title"]);
					assert.notDeepEqual(present, block);
				}),
		);

		it.effect("returns undefined when the document has no frontmatter block at all", () =>
			Effect.gen(function* () {
				const text = "# Widget\n\nNo frontmatter here.\n";
				const document = yield* MarkdownDocument.parse(text, OPTIONS);
				assert.isUndefined(frontmatterPathRange(document, ["type"]));
			}),
		);

		it.effect("includes the delimiting quotes for a double-quoted scalar value (a yaml kit quirk)", () =>
			Effect.gen(function* () {
				const text = '---\ntype: Module\ntitle: "Widget"\n---\n\n# Widget\n';
				const document = yield* MarkdownDocument.parse(text, OPTIONS);
				const range = frontmatterPathRange(document, ["title"]);
				assert.isDefined(range);
				assert.strictEqual(text.slice(range!.offset, range!.offset + range!.length), '"Widget"');
			}),
		);

		it.effect("resolves a value's own range on CRLF source", () =>
			Effect.gen(function* () {
				const text = "---\r\ntype: Module\r\ntitle: Widget\r\n---\r\n\r\n# Widget\r\n";
				const document = yield* MarkdownDocument.parse(text, OPTIONS);
				const range = frontmatterPathRange(document, ["title"]);
				assert.isDefined(range);
				assert.strictEqual(text.slice(range!.offset, range!.offset + range!.length), "Widget");
			}),
		);
	});
});
