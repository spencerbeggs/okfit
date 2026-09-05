import { assert, describe, it } from "@effect/vitest";
import { rootCommand } from "../src/commands/root.js";

describe("rootCommand", () => {
	it("is named okfit", () => {
		assert.strictEqual(rootCommand.name, "okfit");
	});
});
