import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Effect, Option } from "effect";
import { OPTIONS, parseIndex, parseLog } from "../src/internal/reserved.js";
import { indexDocument } from "../src/internal/templates.js";

const parse = (text: string) => MarkdownDocument.parse(text, OPTIONS);

describe("internal/reserved", () => {
	it.effect("parseIndex round-trips an escaped description and title to the original text (issue #72)", () =>
		Effect.gen(function* () {
			const text = indexDocument([
				{
					heading: "Metric",
					entries: [
						{ title: "<Weird> *Title*", target: "weird.md", description: "Point resource at <pkg>/src, a * b" },
					],
				},
			]);
			const document = yield* parse(text);
			const result = parseIndex({ file: "index.md", dir: "", document, frontmatter: Option.none() });
			assert.deepStrictEqual(result.diagnostics, []);
			assert.deepStrictEqual(
				result.document.sections.map((s) => [s.heading, s.entries.map((e) => [e.title, e.target, e.description])]),
				[["Metric", [["<Weird> *Title*", "weird.md", "Point resource at <pkg>/src, a * b"]]]],
			);
		}),
	);

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
			assert.deepStrictEqual(
				root.diagnostics.map((d) => d.code),
				["index-malformed", "index-malformed"],
			);
			assert.strictEqual(root.document.okfVersion, "0.2");
			assert.strictEqual(root.document.metadata?.extra, 1);
		}),
	);
	it.effect("keeps v0.3 root metadata, extension keys and the raw frontmatter text (OKF 0.3 §8.1)", () =>
		Effect.gen(function* () {
			const yaml =
				'okf_version: "0.3"\ntitle: Acme retail analytics\ndescription: Tables and metrics.\nlicense: CC-BY-4.0\nx-acme-owner: finance';
			const document = yield* parse(`---\n${yaml}\n---\n\n# Metric\n\n* [Revenue](revenue.md)\n`);
			const frontmatter = {
				okf_version: "0.3",
				title: "Acme retail analytics",
				description: "Tables and metrics.",
				license: "CC-BY-4.0",
				"x-acme-owner": "finance",
			};
			const result = parseIndex({ file: "index.md", dir: "", document, frontmatter: Option.some(frontmatter) });
			assert.deepStrictEqual(result.diagnostics, []);
			assert.strictEqual(result.document.okfVersion, "0.3");
			assert.strictEqual(result.document.title, "Acme retail analytics");
			assert.strictEqual(result.document.description, "Tables and metrics.");
			assert.strictEqual(result.document.license, "CC-BY-4.0");
			assert.strictEqual(result.document.metadata?.["x-acme-owner"], "finance");
			assert.strictEqual(result.document.frontmatter, yaml);
		}),
	);
	it.effect("warns on an unquoted, unparsable or wrong-typed root key and still reads it best-effort", () =>
		Effect.gen(function* () {
			const run = (yaml: string, value: unknown) =>
				Effect.gen(function* () {
					const document = yield* parse(`---\n${yaml}\n---\n\n# Metric\n`);
					return parseIndex({ file: "index.md", dir: "", document, frontmatter: Option.some(value) });
				});
			const summary = (r: ReturnType<typeof parseIndex>) =>
				r.diagnostics.map((d) => [d.code, d.severity, d.range?.line]);
			const unquoted = yield* run("okf_version: 0.2", { okf_version: 0.2 });
			assert.deepStrictEqual(summary(unquoted), [["index-metadata-invalid", "warning", 1]]);
			assert.strictEqual(unquoted.document.okfVersion, "0.2");
			const zeroTen = yield* run("okf_version: 0.10", { okf_version: 0.1 });
			assert.deepStrictEqual(summary(zeroTen), [["index-metadata-invalid", "warning", 1]]);
			assert.strictEqual(zeroTen.document.okfVersion, "0.1");
			const boolVersion = yield* run("okf_version: true", { okf_version: true });
			assert.deepStrictEqual(summary(boolVersion), [["index-metadata-invalid", "warning", 1]]);
			assert.strictEqual(boolVersion.document.okfVersion, "true");
			const wrongDescription = yield* run("description: 5\nlicense: [a]", { description: 5, license: ["a"] });
			assert.deepStrictEqual(summary(wrongDescription), [
				["index-metadata-invalid", "warning", 1],
				["index-metadata-invalid", "warning", 2],
			]);
			assert.strictEqual(wrongDescription.document.description, undefined);
			assert.strictEqual(wrongDescription.document.license, undefined);
			assert.strictEqual(wrongDescription.document.metadata?.description, 5);
			assert.deepStrictEqual(wrongDescription.document.metadata?.license, ["a"]);
			const emptyBlock = yield* run("", null);
			assert.deepStrictEqual(emptyBlock.diagnostics, []);
			assert.strictEqual(emptyBlock.document.metadata, undefined);
			const prefixed = yield* run('okf_version: "v0.3"', { okf_version: "v0.3" });
			assert.deepStrictEqual(summary(prefixed), [["index-metadata-invalid", "warning", 1]]);
			assert.strictEqual(prefixed.document.okfVersion, "v0.3");
			const empty = yield* run('okf_version: ~\ntitle: ""', { okf_version: null, title: "" });
			assert.deepStrictEqual(empty.diagnostics, []);
			assert.strictEqual(empty.document.okfVersion, undefined);
			assert.strictEqual(empty.document.title, undefined);
			const wrongTitle = yield* run("title: 5", { title: 5 });
			assert.deepStrictEqual(summary(wrongTitle), [["index-metadata-invalid", "warning", 1]]);
			assert.strictEqual(wrongTitle.document.title, undefined);
			assert.strictEqual(wrongTitle.document.metadata?.title, 5);
			const list = yield* run("- a", ["a"]);
			assert.deepStrictEqual(summary(list), [["index-frontmatter", "error", 0]]);
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
