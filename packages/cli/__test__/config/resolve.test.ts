import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { AppDirs as AppDirsType, Xdg as XdgType } from "@effected/xdg";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { OkfitConfig } from "@okfit/core";
import type { FileSystem, Path } from "effect";
import { Effect, Layer, Option } from "effect";
import { buildConfigLayer } from "../../src/config/layer.js";
import { resolveProjectConfig } from "../../src/config/resolve.js";

// Mirrors __test__/config/layer.test.ts's test environment exactly: Xdg's
// own doc comment calls `layerFrom` "the test layer... it needs no
// filesystem"; AppDirs.layer's own R is folded in with provideMerge per
// Judge notes 4 (decision 2), never process.env (decision 2).
const HOME = "/nonexistent/home";
const testXdg = (): Layer.Layer<XdgType> =>
	Xdg.layerFrom(
		XdgPaths.make({
			home: HOME,
			configHome: `${HOME}/.config`,
			dataHome: `${HOME}/.local/share`,
			cacheHome: `${HOME}/.cache`,
			stateHome: `${HOME}/.local/state`,
			configDirs: [],
			dataDirs: [],
		}),
	);

const testEnv: Layer.Layer<AppDirsType | XdgType | FileSystem.FileSystem | Path.Path> = AppDirs.layer({
	namespace: "okfit",
}).pipe(Layer.provideMerge(testXdg()), Layer.provideMerge(NodeServices.layer));

const makeTempDir = async (): Promise<string> => mkdtemp(join(tmpdir(), "okfit-cli-resolve-"));

describe("resolveProjectConfig", () => {
	it.effect("no discovered config yields DEFAULTS merged with the software-project profile", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const layer = buildConfigLayer({ explicitConfigPath: Option.none(), discoveryCwd: dir });
			const resolved = yield* resolveProjectConfig({
				pathArg: Option.none(),
				explicitConfigPath: Option.none(),
				cwd: dir,
			}).pipe(Effect.provide(layer), Effect.provide(testEnv));
			assert.isTrue(Option.isNone(resolved.discovered));
			assert.strictEqual(resolved.profileName, "software-project");
			assert.isTrue(Option.isSome(resolved.profile));
			const expected = OkfitConfig.merge(
				OkfitConfig.merge(OkfitConfig.DEFAULTS, Option.getOrThrow(resolved.profile).config),
				{ extensions: {} },
			);
			assert.deepStrictEqual(resolved.config, expected);
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect('a discovered config with bundle.profile = "none" yields profile none and no warning', () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const configPath = join(dir, "okfit.config.toml");
			yield* Effect.promise(() => writeFile(configPath, 'bundle.profile = "none"\n', "utf8"));
			const layer = buildConfigLayer({ explicitConfigPath: Option.none(), discoveryCwd: dir });
			const resolved = yield* resolveProjectConfig({
				pathArg: Option.none(),
				explicitConfigPath: Option.none(),
				cwd: dir,
			}).pipe(Effect.provide(layer), Effect.provide(testEnv));
			assert.isTrue(Option.isNone(resolved.profile));
			assert.strictEqual(resolved.profileName, "none");
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect(
		"an unknown profile name yields profile none, profileName the unknown name, config DEFAULTS merged with the file",
		() =>
			Effect.gen(function* () {
				const dir = yield* Effect.promise(makeTempDir);
				const configPath = join(dir, "okfit.config.toml");
				yield* Effect.promise(() => writeFile(configPath, 'bundle.profile = "made-up"\n', "utf8"));
				const layer = buildConfigLayer({ explicitConfigPath: Option.none(), discoveryCwd: dir });
				const resolved = yield* resolveProjectConfig({
					pathArg: Option.none(),
					explicitConfigPath: Option.none(),
					cwd: dir,
				}).pipe(Effect.provide(layer), Effect.provide(testEnv));
				assert.isTrue(Option.isNone(resolved.profile));
				assert.strictEqual(resolved.profileName, "made-up");
				const expected = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
					bundle: { profile: "made-up" },
					extensions: {},
				});
				assert.deepStrictEqual(resolved.config, expected);
				yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
			}),
	);

	it.effect("bundleRoot equals path.join(projectRoot, config.bundle.path) for a discovered config", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const nestedDir = join(dir, "project");
			yield* Effect.promise(() => mkdir(nestedDir, { recursive: true }));
			const configPath = join(nestedDir, "okfit.config.toml");
			yield* Effect.promise(() => writeFile(configPath, 'bundle.path = "docs"\n', "utf8"));
			const layer = buildConfigLayer({ explicitConfigPath: Option.none(), discoveryCwd: nestedDir });
			const resolved = yield* resolveProjectConfig({
				pathArg: Option.none(),
				explicitConfigPath: Option.none(),
				cwd: nestedDir,
			}).pipe(Effect.provide(layer), Effect.provide(testEnv));
			assert.isTrue(Option.isSome(resolved.discovered));
			assert.strictEqual(resolved.projectRoot, nestedDir);
			assert.strictEqual(resolved.bundleRoot, join(resolved.projectRoot, "docs"));
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);
});
