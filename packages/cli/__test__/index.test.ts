import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Barrel from "../src/index.js";

// Contract §4's value exports, exactly (same-named types travel with their
// values and add nothing to Object.keys at runtime). The barrel is narrowed
// to the CLI's own surface -- everything that moved to `@okfit/engine` is no
// longer re-exported here; import it from `@okfit/engine` directly.
const VALUES = [
	"CLI_VERSION",
	"human",
	"humanContext",
	"humanVerify",
	"line",
	"renderFailure",
	"rootCommand",
	"summary",
] as const;

describe("@okfit/cli barrel", () => {
	it.effect("exports exactly the contract's value surface (contract section 4, K-48)", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(Object.keys(Barrel).sort(), [...VALUES].sort());
		}),
	);

	it.effect("CLI_VERSION is semver-shaped; in unbuilt source it is the '0.0.0' fallback (K-32)", () =>
		Effect.sync(() => {
			assert.match(Barrel.CLI_VERSION, /^\d+\.\d+\.\d+/);
		}),
	);

	it.effect("never re-exports the commands, Now, or the process-touching internals (K-49)", () =>
		Effect.sync(() => {
			assert.isFalse(Object.hasOwn(Barrel, "validateCommand"));
			assert.isFalse(Object.hasOwn(Barrel, "initCommand"));
			assert.isFalse(Object.hasOwn(Barrel, "contextCommand"));
			assert.isFalse(Object.hasOwn(Barrel, "Now"));
			assert.isFalse(Object.hasOwn(Barrel, "setExitCode"));
			assert.isFalse(Object.hasOwn(Barrel, "useColor"));
		}),
	);

	it.effect('rootCommand is the okfit root, named exactly "okfit" (K-5)', () =>
		Effect.sync(() => {
			assert.strictEqual(Barrel.rootCommand.name, "okfit");
		}),
	);
});
