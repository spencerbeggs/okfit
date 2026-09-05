import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Effect, Option } from "effect";
import { decodeConcept } from "../src/internal/frontmatter.js";

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
});
