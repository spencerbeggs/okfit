import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { staleCommand } from "../../src/commands/stale.js";
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

describe("staleCommand", () => {
	it("is named 'stale' and describes what it does", () => {
		assert.strictEqual(staleCommand.name, "stale");
		assert.isTrue((staleCommand.description ?? "").includes("stale_after"));
	});

	it("declares exactly the path argument and the config/format flags, by name", () => {
		const config = configOf(staleCommand);
		assert.deepStrictEqual(
			config.arguments.map((argument) => nameOf(argument)),
			["path"],
		);
		assert.deepStrictEqual(
			config.flags.map((flag) => nameOf(flag)),
			["config", "format"],
		);
	});

	it('--format defaults to "human"', () => {
		const config = configOf(staleCommand);
		const formatFlag = config.flags.find((flag) => nameOf(flag) === "format") as
			| { readonly f: (value: Option.Option<string>) => string }
			| undefined;
		if (formatFlag === undefined) throw new Error("expected a --format flag with a default-value mapper");
		assert.strictEqual(formatFlag.f(Option.none()), "human");
	});

	it("--config carries no mustExist on its underlying Path primitive", () => {
		const config = configOf(staleCommand);
		const configFlag = config.flags.find((flag) => nameOf(flag) === "config");
		if (configFlag === undefined) throw new Error("expected a --config flag");
		const primitiveType = primitiveTypeOf(configFlag);
		assert.strictEqual(primitiveType._tag, "Path");
		assert.isFalse("mustExist" in primitiveType);
	});
});
