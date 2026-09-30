import { assert, describe, it } from "@effect/vitest";
import { rootCommand } from "../src/commands/root.js";

describe("rootCommand", () => {
	it("is named okfit", () => {
		assert.strictEqual(rootCommand.name, "okfit");
	});

	it("registers query last", () => {
		const names = rootCommand.subcommands.flatMap((group) => group.commands.map((command) => command.name));
		assert.strictEqual(names.at(-1), "query");
	});
});
