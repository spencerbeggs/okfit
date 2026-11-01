import { assert, describe, it } from "@effect/vitest";
import { indexDocument } from "../src/internal/templates.js";

describe("internal/templates indexDocument", () => {
	it("renders H1 sections of tight `*` lists, entries with and without a description", () => {
		assert.strictEqual(
			indexDocument([
				{ heading: "Module", entries: [{ title: "Core", target: "core.md", description: "The core package." }] },
				{ heading: "Subdirectories", entries: [{ title: "decisions", target: "decisions/index.md" }] },
			]),
			"# Module\n\n* [Core](core.md) - The core package.\n\n# Subdirectories\n\n* [decisions](decisions/index.md)\n",
		);
	});

	it("opens the root index with a frontmatter block carrying only okf_version", () => {
		const text = indexDocument([{ heading: "Module", entries: [{ title: "Core", target: "core.md" }] }], "0.2");
		assert.match(text, /^---\nokf_version: ['"]0\.2['"]\n---\n\n# Module\n/);
	});

	it("escapes markdown-active text instead of letting it render as syntax", () => {
		const text = indexDocument([
			{ heading: "Metric", entries: [{ title: "<Weird> *Title*", target: "weird.md", description: "a * b" }] },
		]);
		assert.notInclude(text, "[<Weird> *Title*]");
		assert.notInclude(text, " - a * b");
	});

	it("renders nothing for no sections and no okf_version", () => {
		assert.strictEqual(indexDocument([]), "");
	});
});
