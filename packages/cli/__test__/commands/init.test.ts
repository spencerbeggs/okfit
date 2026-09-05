import { assert, describe, it } from "@effect/vitest";
import { initCommand } from "../../src/commands/init.js";
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

describe("initCommand", () => {
	it("is named init and describes the scaffold it writes (contract section 2)", () => {
		assert.strictEqual(initCommand.name, "init");
		assert.isTrue(initCommand.description?.includes("Scaffold"));
	});

	it("declares no subcommands of its own", () => {
		assert.deepStrictEqual(initCommand.subcommands, []);
	});

	it("declares exactly the path argument and the config/profile flags, by name; no --format (K-6, contract §6.1)", () => {
		const config = configOf(initCommand);
		assert.deepStrictEqual(
			config.arguments.map((argument) => nameOf(argument)),
			["path"],
		);
		assert.deepStrictEqual(
			config.flags.map((flag) => nameOf(flag)),
			["config", "profile"],
		);
	});

	it("--config carries no mustExist on its underlying Path primitive (contract §6.1)", () => {
		const config = configOf(initCommand);
		const configFlag = config.flags.find((flag) => nameOf(flag) === "config");
		if (configFlag === undefined) throw new Error("expected a --config flag");
		const primitiveType = primitiveTypeOf(configFlag);
		assert.strictEqual(primitiveType._tag, "Path");
		assert.isFalse("mustExist" in primitiveType);
	});
});
