import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { contextCommand } from "../../src/commands/context.js";
import { rootCommand } from "../../src/commands/root.js";
import { nameOf, primitiveTypeOf } from "../utils/params.js";

/** `Command`'s public interface declares no `config` member; every real command carries one at runtime. */
const configOf = (
	command: unknown,
): { readonly arguments: ReadonlyArray<unknown>; readonly flags: ReadonlyArray<unknown> } =>
	(
		command as {
			readonly config: { readonly arguments: ReadonlyArray<unknown>; readonly flags: ReadonlyArray<unknown> };
		}
	).config;

describe("contextCommand", () => {
	it("is named 'context' and describes what it does (contract §8.3)", () => {
		assert.strictEqual(contextCommand.name, "context");
		assert.isTrue((contextCommand.description ?? "").includes("vocabulary"));
	});

	it("declares no subcommands of its own", () => {
		assert.deepStrictEqual(contextCommand.subcommands, []);
	});

	it("declares exactly the path argument and the config/format flags, by name; no --profile (M-15)", () => {
		const config = configOf(contextCommand);
		assert.deepStrictEqual(
			config.arguments.map((argument) => nameOf(argument)),
			["path"],
		);
		assert.deepStrictEqual(
			config.flags.map((flag) => nameOf(flag)),
			["config", "format"],
		);
	});

	it('--format defaults to "human" (contract §8.3)', () => {
		const config = configOf(contextCommand);
		const formatFlag = config.flags.find((flag) => nameOf(flag) === "format") as
			| { readonly f: (value: Option.Option<string>) => string }
			| undefined;
		if (formatFlag === undefined) throw new Error("expected a --format flag with a default-value mapper");
		assert.strictEqual(formatFlag.f(Option.none()), "human");
	});

	it("--config carries no mustExist on its underlying Path primitive (contract §8.3)", () => {
		const config = configOf(contextCommand);
		const configFlag = config.flags.find((flag) => nameOf(flag) === "config");
		if (configFlag === undefined) throw new Error("expected a --config flag");
		const primitiveType = primitiveTypeOf(configFlag);
		assert.strictEqual(primitiveType._tag, "Path");
		assert.isFalse("mustExist" in primitiveType);
	});
});

describe("rootCommand", () => {
	it("registers exactly validate, init, and context, in that order (contract §8.6)", () => {
		// `Command.subcommands` is grouped (`{ group, commands }[]`), not a flat
		// array (same shape `__test__/commands/init.test.ts` already asserted
		// against for the two-command tree; this is that same assertion, moved
		// here and updated to three commands per this group's decision 3).
		assert.deepStrictEqual(
			rootCommand.subcommands.flatMap((group) => group.commands.map((command) => command.name)),
			["validate", "init", "context"],
		);
	});
});
