import { assert, describe, it } from "@effect/vitest";
import { initCommand } from "../../src/commands/init.js";
import { rootCommand } from "../../src/commands/root.js";

describe("initCommand", () => {
	it("is named init and describes the scaffold it writes (contract section 2)", () => {
		assert.strictEqual(initCommand.name, "init");
		assert.isTrue(initCommand.description?.includes("Scaffold"));
	});

	it("declares no subcommands of its own", () => {
		assert.deepStrictEqual(initCommand.subcommands, []);
	});
});

describe("rootCommand", () => {
	it("registers exactly validate and init, in that order (K-5)", () => {
		// `Command.subcommands` is grouped (`{ group, commands }[]`, `unstable/cli/Command.ts:158`),
		// not a flat array of commands, so the brief's literal `.map((s) => s.name)` does not
		// typecheck against the installed shape (installed `.d.ts` wins, per this repo's rule) —
		// flatten the one ungrouped registration `Command.withSubcommands` produced instead.
		assert.deepStrictEqual(
			rootCommand.subcommands.flatMap((group) => group.commands.map((command) => command.name)),
			["validate", "init"],
		);
	});
});
