import { assert, describe, it } from "@effect/vitest";
import { rootCommand } from "../../src/commands/root.js";
import { validateCommand } from "../../src/commands/validate.js";

describe("validateCommand", () => {
	it("is named 'validate' and describes what it does (K-2, K-6)", () => {
		assert.strictEqual(validateCommand.name, "validate");
		assert.isTrue((validateCommand.description ?? "").includes("diagnostics"));
	});
});

describe("rootCommand", () => {
	it("is still named 'okfit' once validate is registered (K-5)", () => {
		assert.strictEqual(rootCommand.name, "okfit");
	});
});
