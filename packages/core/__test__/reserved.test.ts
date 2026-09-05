import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Effect, Option } from "effect";
import { OPTIONS, parseIndex, parseLog } from "../src/internal/reserved.js";

const parse = (text: string) => MarkdownDocument.parse(text, OPTIONS);

describe("internal/reserved", () => {
	it.effect("parses index sections, entries and okf_version on the root index", () =>
		Effect.gen(function* () {
			const document = yield* parse(
				'---\nokf_version: "0.2"\n---\n\nIntro prose.\n\n# Metric\n\n* [Gross Margin](gross-margin.md) - Margin after COGS.\n- [Plain](plain.md)\n\n# Subdirectories\n\n* [tables](tables/index.md) - Tables\n',
			);
			const result = parseIndex({
				file: "index.md",
				dir: "",
				document,
				frontmatter: Option.some({ okf_version: "0.2" }),
			});
			assert.deepStrictEqual(result.diagnostics, []);
			assert.strictEqual(result.document.okfVersion, "0.2");
			assert.deepStrictEqual(
				result.document.sections.map((s) => [s.heading, s.entries.map((e) => [e.title, e.target, e.description])]),
				[
					[
						"Metric",
						[
							["Gross Margin", "gross-margin.md", "Margin after COGS."],
							["Plain", "plain.md", undefined],
						],
					],
					["Subdirectories", [["tables", "tables/index.md", "Tables"]]],
				],
			);
			assert.strictEqual(result.document.sections[0]?.entries[0]?.range.line, 8);
		}),
	);
	it.effect("flags foreign frontmatter and malformed blocks", () =>
		Effect.gen(function* () {
			const document = yield* parse("---\ntitle: nope\n---\n\n# Things\n\n* no link here\n\nA stray paragraph.\n");
			const sub = parseIndex({
				file: "sub/index.md",
				dir: "sub",
				document,
				frontmatter: Option.some({ title: "nope" }),
			});
			assert.deepStrictEqual(
				sub.diagnostics.map((d) => [d.code, d.range?.line]),
				[
					["index-frontmatter", 0],
					["index-malformed", 6],
					["index-malformed", 8],
				],
			);
			const root = parseIndex({
				file: "index.md",
				dir: "",
				document,
				frontmatter: Option.some({ okf_version: "0.2", extra: 1 }),
			});
			assert.strictEqual(root.diagnostics[0]?.code, "index-frontmatter");
			assert.strictEqual(root.document.okfVersion, undefined);
		}),
	);
	it.effect("parses log date groups; flags bad headings, early lists and prose in groups", () =>
		Effect.gen(function* () {
			const document = yield* parse(
				"---\ntype: Log\n---\n\n# Bundle history\n\n* early item\n\n## 2026-07-01\n\n- **Verified** by [J](/x.md).\n- second\n\nStray prose.\n\n## July 2026\n\n* ignored\n",
			);
			const result = parseLog({ file: "log.md", dir: "", document });
			assert.deepStrictEqual(
				result.diagnostics.map((d) => [d.code, d.severity, d.range?.line]),
				[
					["log-frontmatter", "warning", 0],
					["log-malformed", "error", 6],
					["log-malformed", "error", 13],
					["log-heading-invalid", "error", 15],
				],
			);
			assert.strictEqual(result.document.title, "Bundle history");
			assert.deepStrictEqual(
				result.document.groups.map((g) => [g.date, g.items.map((i) => i.text)]),
				[["2026-07-01", ["**Verified** by [J](/x.md).", "second"]]],
			);
		}),
	);
});
