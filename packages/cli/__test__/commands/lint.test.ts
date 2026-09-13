import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { lintCommand } from "../../src/commands/lint.js";
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

describe("lintCommand", () => {
	it("is named 'lint' and describes what it does", () => {
		assert.strictEqual(lintCommand.name, "lint");
		assert.isTrue((lintCommand.description ?? "").includes("diagnostics"));
	});

	it("declares exactly the path argument and the config/format/skip-provenance flags, by name", () => {
		const config = configOf(lintCommand);
		assert.deepStrictEqual(
			config.arguments.map((argument) => nameOf(argument)),
			["path"],
		);
		assert.deepStrictEqual(
			config.flags.map((flag) => nameOf(flag)),
			["config", "format", "skip-provenance"],
		);
	});

	it('--format defaults to "human"', () => {
		const config = configOf(lintCommand);
		const formatFlag = config.flags.find((flag) => nameOf(flag) === "format") as
			| { readonly f: (value: Option.Option<string>) => string }
			| undefined;
		if (formatFlag === undefined) throw new Error("expected a --format flag with a default-value mapper");
		assert.strictEqual(formatFlag.f(Option.none()), "human");
	});

	it("--skip-provenance defaults to false", () => {
		const config = configOf(lintCommand);
		const skipProvenanceFlag = config.flags.find((flag) => nameOf(flag) === "skip-provenance") as
			| { readonly f: (value: Option.Option<boolean>) => boolean }
			| undefined;
		if (skipProvenanceFlag === undefined)
			throw new Error("expected a --skip-provenance flag with a default-value mapper");
		assert.strictEqual(skipProvenanceFlag.f(Option.none()), false);
	});

	it("--config carries no mustExist on its underlying Path primitive", () => {
		const config = configOf(lintCommand);
		const configFlag = config.flags.find((flag) => nameOf(flag) === "config");
		if (configFlag === undefined) throw new Error("expected a --config flag");
		const primitiveType = primitiveTypeOf(configFlag);
		assert.strictEqual(primitiveType._tag, "Path");
		assert.isFalse("mustExist" in primitiveType);
	});
});
