import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Bundle, Validate } from "@okfit/core";
import { Effect, Option } from "effect";
import { buildConfigLayer } from "../../src/config/layer.js";
import { resolveProjectConfig } from "../../src/config/resolve.js";
import { V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, projectPlatform } from "../utils/bundle.js";
import { testEnv } from "../utils/configEnv.js";

const makeTempDir = async (): Promise<string> => mkdtemp(join(tmpdir(), "okfit-cli-resolve-"));

const resolveWith = (toml: string | undefined) =>
	Effect.gen(function* () {
		const dir = yield* Effect.promise(makeTempDir);
		if (toml !== undefined) yield* Effect.promise(() => writeFile(join(dir, "okfit.toml"), toml, "utf8"));
		const layer = buildConfigLayer({ explicitConfigPath: Option.none(), discoveryCwd: dir });
		return yield* resolveProjectConfig({ pathArg: Option.none(), explicitConfigPath: Option.none(), cwd: dir }).pipe(
			Effect.provide(layer),
			Effect.provide(testEnv),
			Effect.ensuring(Effect.promise(() => rm(dir, { recursive: true, force: true }))),
		);
	});

/** The `non-concept-unlisted` files for a bundle holding a root README.md and a typeless notes/x.md. */
const unlistedUnder = (toml: string | undefined) =>
	Effect.gen(function* () {
		const { config } = yield* resolveWith(toml);
		const bundle = yield* Bundle.load({ root: ROOT }).pipe(
			Effect.provide(projectPlatform({ ...V03_PROJECT, "okf/notes/x.md": "# X\n" })),
		);
		return Validate.lint(bundle, config)
			.filter((d) => d.code === "non-concept-unlisted")
			.map((d) => d.file)
			.sort();
	});

describe("[bundle] non_concepts through the real config loader", () => {
	it.effect("DEFAULTS < software-project < user file: a user list replaces the profile's, [] allows none", () =>
		Effect.gen(function* () {
			// control: no user key, the profile's four names allow README.md; notes/x.md fires
			assert.deepStrictEqual(yield* unlistedUnder(undefined), ["notes/x.md"]);
			// a user list replaces the four names wholesale
			assert.deepStrictEqual(yield* unlistedUnder('[bundle]\nnon_concepts = ["notes/**"]\n'), ["README.md"]);
			// an empty user list survives the merge and allows none
			assert.deepStrictEqual(yield* unlistedUnder("[bundle]\nnon_concepts = []\n"), ["README.md", "notes/x.md"]);
		}),
	);

	it.effect("an uncompilable glob is rejected at config load, and the typed issue names the key", () =>
		Effect.gen(function* () {
			const error = yield* resolveWith('[bundle]\nnon_concepts = ["[[:alpha:]]{0..99}{0..99}"]\n').pipe(Effect.flip);
			assert.strictEqual((error as { _tag?: unknown })._tag, "ConfigValidationError");
			// the loader's one-line message is generic for every invalid key; the typed issue names the key and the reason
			const detail = JSON.stringify(error);
			assert.include(detail, "non_concepts");
			assert.include(detail, "Expected a valid glob pattern");
		}),
	);
});
