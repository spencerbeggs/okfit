import { assert, describe, it } from "@effect/vitest";
import { queryCommand, queryGetCommand, queryListCommand, queryNeighborsCommand } from "../../src/commands/query.js";
import { nameOf } from "../utils/params.js";

/** `Command`'s public interface declares no `config` member; every real command carries one at runtime. */
const configOf = (
	command: unknown,
): { readonly arguments: ReadonlyArray<unknown>; readonly flags: ReadonlyArray<unknown> } =>
	(
		command as {
			readonly config: { readonly arguments: ReadonlyArray<unknown>; readonly flags: ReadonlyArray<unknown> };
		}
	).config;

describe("queryCommand", () => {
	it("is named query with list, get, neighbors subcommands in that order", () => {
		assert.strictEqual(queryCommand.name, "query");
		assert.deepStrictEqual(
			queryCommand.subcommands.flatMap((group) => group.commands.map((command) => command.name)),
			["list", "get", "neighbors"],
		);
	});

	it("list takes no positionals and the root/config/type/tag/status/verified/unverified/drifted/stale/format flags", () => {
		const config = configOf(queryListCommand);
		assert.deepStrictEqual(
			config.arguments.map((a) => nameOf(a)),
			[],
		);
		assert.deepStrictEqual(
			config.flags.map((f) => nameOf(f)),
			["root", "config", "type", "tag", "status", "verified", "unverified", "drifted", "stale", "format"],
		);
	});

	it.each([
		["get", queryGetCommand, "targets"],
		["neighbors", queryNeighborsCommand, "target"],
	])("%s takes the %s argument and the root/config/format flags", (_name, command, argument) => {
		const config = configOf(command);
		assert.deepStrictEqual(
			config.arguments.map((a) => nameOf(a)),
			[argument],
		);
		assert.deepStrictEqual(
			config.flags.map((f) => nameOf(f)),
			["root", "config", "format"],
		);
	});
});
