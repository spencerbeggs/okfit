import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { AppDirs as AppDirsType, Xdg as XdgType } from "@effected/xdg";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { OkfitConfigFile } from "@okfit/core";
import type { FileSystem, Path } from "effect";
import { Effect, Layer, Option } from "effect";
import { buildConfigLayer, provideConfig } from "../../src/config/layer.js";
import { ConfigPathNotFoundError } from "../../src/errors.js";

// Xdg's own doc comment: "the test layer, and the escape hatch for an
// application that resolves its environment some other way. It needs no
// filesystem" (XDG/index.d.ts:106-125). Never touches process.env (decision 2).
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

// AppDirs.layer's own R (Xdg | FileSystem | Path) is folded in with
// provideMerge, never mergeAll, per Judge notes 4 (decision 2).
//
// Deviation from the brief's literal snippet: `provideMerge` folds BOTH
// layers' outputs (`effect/Layer.ts`'s own signature,
// `Layer<ROut | ROut2, E | E2, RIn | Exclude<RIn2, ROut>>`), so
// `NodeServices.layer`'s `FileSystem | Path` (and the rest of
// `NodeServices`) end up in this layer's real `ROut` too — the brief's
// `Layer.Layer<AppDirsType | XdgType>` annotation understates it and left
// `FileSystem | Path` stranded in `R` at every call site below under
// `exactOptionalPropertyTypes`. Widened to the type `provideMerge` actually
// infers.
const testEnv: Layer.Layer<AppDirsType | XdgType | FileSystem.FileSystem | Path.Path> = AppDirs.layer({
	namespace: "okfit",
}).pipe(Layer.provideMerge(testXdg()), Layer.provideMerge(NodeServices.layer));

const makeTempDir = async (): Promise<string> => mkdtemp(join(tmpdir(), "okfit-cli-layer-"));

describe("buildConfigLayer", () => {
	it.effect('the explicit branch discovers exactly the named path, resolver "explicit"', () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const configPath = join(dir, "config.toml");
			yield* Effect.promise(() => writeFile(configPath, 'bundle.path = "docs"\n', "utf8"));
			const layer = buildConfigLayer({ explicitConfigPath: Option.some(configPath), discoveryCwd: dir });
			const program = Effect.gen(function* () {
				const configFile = yield* OkfitConfigFile;
				return yield* configFile.discover;
			});
			const sources = yield* program.pipe(Effect.provide(layer), Effect.provide(testEnv));
			assert.strictEqual(sources.length, 1);
			assert.strictEqual(sources[0]?.path, configPath);
			assert.strictEqual(sources[0]?.resolver, "explicit");
			assert.strictEqual(sources[0]?.value.bundle?.path, "docs");
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect(
		"the discovery branch prefers .config/okfit/config.toml over a co-present okfit.config.toml (K-10 order)",
		() =>
			Effect.gen(function* () {
				const dir = yield* Effect.promise(makeTempDir);
				const winningDir = join(dir, ".config", "okfit");
				yield* Effect.promise(() => mkdir(winningDir, { recursive: true }));
				const winningPath = join(winningDir, "config.toml");
				yield* Effect.promise(() => writeFile(winningPath, 'bundle.path = "from-dotconfig"\n', "utf8"));
				const losingPath = join(dir, "okfit.config.toml");
				yield* Effect.promise(() => writeFile(losingPath, 'bundle.path = "from-flat-file"\n', "utf8"));
				const layer = buildConfigLayer({ explicitConfigPath: Option.none(), discoveryCwd: dir });
				const program = Effect.gen(function* () {
					const configFile = yield* OkfitConfigFile;
					return yield* configFile.discover;
				});
				const sources = yield* program.pipe(Effect.provide(layer), Effect.provide(testEnv));
				assert.strictEqual(sources.length, 2);
				assert.strictEqual(sources[0]?.path, winningPath);
				assert.strictEqual(sources[0]?.resolver, "walk");
				assert.strictEqual(sources[0]?.value.bundle?.path, "from-dotconfig");
				yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
			}),
	);

	it.effect("the discovery branch finds okfit.config.toml alone", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const flatPath = join(dir, "okfit.config.toml");
			yield* Effect.promise(() => writeFile(flatPath, 'bundle.path = "flat"\n', "utf8"));
			const layer = buildConfigLayer({ explicitConfigPath: Option.none(), discoveryCwd: dir });
			const program = Effect.gen(function* () {
				const configFile = yield* OkfitConfigFile;
				return yield* configFile.discover;
			});
			const sources = yield* program.pipe(Effect.provide(layer), Effect.provide(testEnv));
			assert.strictEqual(sources.length, 1);
			assert.strictEqual(sources[0]?.path, flatPath);
			assert.strictEqual(sources[0]?.resolver, "walk");
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);
});

describe("provideConfig", () => {
	it.effect("fails with ConfigPathNotFoundError before building any layer when --config is missing", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const missing = join(dir, "nope.toml");
			const program = Effect.gen(function* () {
				const configFile = yield* OkfitConfigFile;
				return yield* configFile.discover;
			});
			const result = yield* program
				.pipe(provideConfig({ explicitConfigPath: Option.some(missing), discoveryCwd: dir }))
				.pipe(Effect.provide(testEnv), Effect.flip);
			assert.isTrue(result instanceof ConfigPathNotFoundError);
			assert.strictEqual((result as ConfigPathNotFoundError).path, missing);
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect("provides OkfitConfigFile and succeeds when --config exists", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const configPath = join(dir, "config.toml");
			yield* Effect.promise(() => writeFile(configPath, 'bundle.path = "docs"\n', "utf8"));
			const program = Effect.gen(function* () {
				const configFile = yield* OkfitConfigFile;
				return yield* configFile.discover;
			});
			const sources = yield* program
				.pipe(provideConfig({ explicitConfigPath: Option.some(configPath), discoveryCwd: dir }))
				.pipe(Effect.provide(testEnv));
			assert.strictEqual(sources.length, 1);
			assert.strictEqual(sources[0]?.value.bundle?.path, "docs");
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect("provides OkfitConfigFile over the discovery branch when no --config is given", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const flatPath = join(dir, "okfit.config.toml");
			yield* Effect.promise(() => writeFile(flatPath, 'bundle.path = "flat"\n', "utf8"));
			const program = Effect.gen(function* () {
				const configFile = yield* OkfitConfigFile;
				return yield* configFile.discover;
			});
			const sources = yield* program
				.pipe(provideConfig({ explicitConfigPath: Option.none(), discoveryCwd: dir }))
				.pipe(Effect.provide(testEnv));
			assert.strictEqual(sources.length, 1);
			assert.strictEqual(sources[0]?.value.bundle?.path, "flat");
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);
});
