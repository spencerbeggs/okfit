import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { rootCommand } from "../../src/commands/root.js";
import { validateCommand } from "../../src/commands/validate.js";
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

describe("validateCommand", () => {
	it("is named 'validate' and describes what it does (K-2, K-6)", () => {
		assert.strictEqual(validateCommand.name, "validate");
		assert.isTrue((validateCommand.description ?? "").includes("diagnostics"));
	});

	it("declares exactly the path argument and the config/format/skip-provenance flags, by name (contract §6.1, S-31)", () => {
		const config = configOf(validateCommand);
		assert.deepStrictEqual(
			config.arguments.map((argument) => nameOf(argument)),
			["path"],
		);
		assert.deepStrictEqual(
			config.flags.map((flag) => nameOf(flag)),
			["config", "format", "skip-provenance"],
		);
	});

	it('--format defaults to "human" (contract §6.1)', () => {
		const config = configOf(validateCommand);
		const formatFlag = config.flags.find((flag) => nameOf(flag) === "format") as
			| { readonly f: (value: Option.Option<string>) => string }
			| undefined;
		if (formatFlag === undefined) throw new Error("expected a --format flag with a default-value mapper");
		assert.strictEqual(formatFlag.f(Option.none()), "human");
	});

	it("--skip-provenance defaults to false (S-31)", () => {
		const config = configOf(validateCommand);
		const skipProvenanceFlag = config.flags.find((flag) => nameOf(flag) === "skip-provenance") as
			| { readonly f: (value: Option.Option<boolean>) => boolean }
			| undefined;
		if (skipProvenanceFlag === undefined)
			throw new Error("expected a --skip-provenance flag with a default-value mapper");
		assert.strictEqual(skipProvenanceFlag.f(Option.none()), false);
	});

	it("--config carries no mustExist on its underlying Path primitive (contract §6.1)", () => {
		const config = configOf(validateCommand);
		const configFlag = config.flags.find((flag) => nameOf(flag) === "config");
		if (configFlag === undefined) throw new Error("expected a --config flag");
		const primitiveType = primitiveTypeOf(configFlag);
		assert.strictEqual(primitiveType._tag, "Path");
		assert.isFalse("mustExist" in primitiveType);
	});
});

describe("rootCommand", () => {
	it("is still named 'okfit' once validate is registered (K-5)", () => {
		assert.strictEqual(rootCommand.name, "okfit");
	});
});
