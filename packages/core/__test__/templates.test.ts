import { assert, describe, it } from "@effect/vitest";
import { indexEntry } from "../src/internal/templates.js";

describe("internal/templates indexEntry", () => {
	it("backslash-escapes markdown-active characters in the description", () => {
		assert.strictEqual(
			indexEntry({ title: "Point resource", target: "pkg/index.md", description: "Point resource at <pkg>/src" }),
			"* [Point resource](pkg/index.md) - Point resource at \\<pkg\\>/src",
		);
		assert.strictEqual(
			indexEntry({ title: "Math", target: "math.md", description: "a * b" }),
			"* [Math](math.md) - a \\* b",
		);
	});

	it("backslash-escapes markdown-active characters in the title", () => {
		assert.strictEqual(
			indexEntry({ title: "<Weird> *Title*", target: "weird.md" }),
			"* [\\<Weird\\> \\*Title\\*](weird.md)",
		);
	});

	it("leaves plain text untouched", () => {
		assert.strictEqual(
			indexEntry({ title: "Core", target: "core.md", description: "The core package." }),
			"* [Core](core.md) - The core package.",
		);
	});
});
