import { assert, describe, it } from "@effect/vitest";
import { graphCommand } from "../../src/commands/graph.js";
import { defaultOf, nameOf, primitiveTypeOf } from "../utils/params.js";

/** `Command`'s public interface declares no `config` member; every real command carries one at runtime. */
const configOf = (
	command: unknown,
): { readonly arguments: ReadonlyArray<unknown>; readonly flags: ReadonlyArray<unknown> } =>
	(
		command as {
			readonly config: { readonly arguments: ReadonlyArray<unknown>; readonly flags: ReadonlyArray<unknown> };
		}
	).config;

describe("graphCommand", () => {
	it("is named 'graph' and describes what it does", () => {
		assert.strictEqual(graphCommand.name, "graph");
		assert.isTrue((graphCommand.description ?? "").includes("graph"));
	});

	it("declares no positionals and the root/ the config/format flags, by name", () => {
		const config = configOf(graphCommand);
		assert.deepStrictEqual(
			config.arguments.map((argument) => nameOf(argument)),
			[],
		);
		assert.deepStrictEqual(
			config.flags.map((flag) => nameOf(flag)),
			["root", "config", "format"],
		);
	});

	it('--format defaults to "mermaid", unlike every other command\'s "human" default', () => {
		const config = configOf(graphCommand);
		const formatFlag = config.flags.find((flag) => nameOf(flag) === "format");
		if (formatFlag === undefined) throw new Error("expected a --format flag");
		assert.strictEqual(defaultOf(formatFlag), "mermaid");
	});

	it("--config carries no mustExist on its underlying Path primitive", () => {
		const config = configOf(graphCommand);
		const configFlag = config.flags.find((flag) => nameOf(flag) === "config");
		if (configFlag === undefined) throw new Error("expected a --config flag");
		const primitiveType = primitiveTypeOf(configFlag);
		assert.strictEqual(primitiveType._tag, "Path");
		assert.isFalse("mustExist" in primitiveType);
	});
});
