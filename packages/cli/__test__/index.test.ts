import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Barrel from "../src/index.js";

// Contract §4's value exports, exactly (same-named types travel with their
// values and add nothing to Object.keys at runtime). ConfigMalformedError is
// a controller-ruled addition alongside the other errors (see task brief).
const VALUES = [
	"CLI_VERSION",
	"CONFIG_RELATIVE_PATH",
	"ConfigMalformedError",
	"ConfigPathNotFoundError",
	"ContextEnvelope",
	"ContextTag",
	"ContextType",
	"DEFAULT_PROFILE_NAME",
	"InitOverwriteError",
	"VerifyConceptNotFoundError",
	"VerifyUnsupportedFrontmatterError",
	"JsonDiagnostic",
	"JsonEnvelope",
	"JsonErrorEnvelope",
	"JsonSummary",
	"buildConfigLayer",
	"collect",
	"configValue",
	"contextEnvelope",
	"files",
	"forDiagnostics",
	"human",
	"humanContext",
	"json",
	"jsonError",
	"line",
	"provideConfig",
	"renderFailure",
	"resolveBundleRoot",
	"resolveProjectConfig",
	"resolveProjectRoot",
	"rootCommand",
	"run",
	"runContext",
	"sort",
	"summary",
	"tally",
	"targetPaths",
	"VerifyEnvelope",
	"humanVerify",
	"verifyEnvelope",
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
