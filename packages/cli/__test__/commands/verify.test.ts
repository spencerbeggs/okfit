import { assert, describe, it } from "@effect/vitest";
import { verifyCommand } from "../../src/commands/verify.js";
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

describe("verifyCommand", () => {
	it("is named verify and describes the attestation it records (contract §2.1)", () => {
		assert.strictEqual(verifyCommand.name, "verify");
		assert.isTrue(verifyCommand.description?.includes("attestation"));
	});

	it("declares no subcommands of its own", () => {
		assert.deepStrictEqual(verifyCommand.subcommands, []);
	});

	it("declares the id and path arguments and the config/at/dry-run/format flags, by name; no --by (V-7)", () => {
		const config = configOf(verifyCommand);
		assert.deepStrictEqual(
			config.arguments.map((argument) => nameOf(argument)),
			["id", "path"],
		);
		assert.deepStrictEqual(
			config.flags.map((flag) => nameOf(flag)),
			["config", "at", "dry-run", "format"],
		);
	});

	it("--config carries no mustExist on its underlying Path primitive (K-1)", () => {
		const config = configOf(verifyCommand);
		const configFlag = config.flags.find((flag) => nameOf(flag) === "config");
		if (configFlag === undefined) throw new Error("expected a --config flag");
		const primitiveType = primitiveTypeOf(configFlag);
		assert.strictEqual(primitiveType._tag, "Path");
		assert.isFalse("mustExist" in primitiveType);
	});

	it("--at is a string primitive, not a date (V-6)", () => {
		const config = configOf(verifyCommand);
		const atFlag = config.flags.find((flag) => nameOf(flag) === "at");
		if (atFlag === undefined) throw new Error("expected an --at flag");
		assert.notStrictEqual(primitiveTypeOf(atFlag)._tag, "Date");
	});

	it("--dry-run is a boolean primitive defaulting to false", () => {
		const config = configOf(verifyCommand);
		const dryRunFlag = config.flags.find((flag) => nameOf(flag) === "dry-run");
		if (dryRunFlag === undefined) throw new Error("expected a --dry-run flag");
		assert.strictEqual(primitiveTypeOf(dryRunFlag)._tag, "Boolean");
	});
});
