import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { AppDirs as AppDirsType, Xdg as XdgType } from "@effected/xdg";
import { AppDirs, CurrentPlatform, Xdg, XdgPaths } from "@effected/xdg";
import { OkfitConfigFile } from "@okfit/core";
import type { FileSystem, Path } from "effect";
import { Effect, Layer, Option } from "effect";
import { buildConfigLayer, provideConfig } from "../../src/config/layer.js";
import { ConfigMalformedError, ConfigPathNotFoundError } from "../../src/errors.js";

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

// A sandbox-scoped environment: XDG at <root>/xdg, native ("darwin") at
// <root>/home/Library/Application Support/okfit, so both tiers are writable
// temp directories rather than host paths (K-43's discipline).
const testEnvAt = (root: string): Layer.Layer<AppDirsType | XdgType | FileSystem.FileSystem | Path.Path> =>
	AppDirs.layer({ namespace: "okfit" }).pipe(
		Layer.provideMerge(
			Xdg.layerFrom(
				XdgPaths.make({
					home: join(root, "home"),
					configHome: join(root, "xdg"),
					dataHome: join(root, "data"),
					cacheHome: join(root, "cache"),
					stateHome: join(root, "state"),
					configDirs: [],
					dataDirs: [],
				}),
			),
		),
		Layer.provideMerge(Layer.succeed(CurrentPlatform, "darwin")),
		Layer.provideMerge(NodeServices.layer),
	);

const discoverIn = (root: string, options: { readonly discoveryCwd: string; readonly systemConfigDir?: string }) =>
	Effect.gen(function* () {
		const configFile = yield* OkfitConfigFile;
		return yield* configFile.discover;
	}).pipe(
		Effect.provide(buildConfigLayer({ explicitConfigPath: Option.none(), ...options })),
		Effect.provide(testEnvAt(root)),
	);

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

	it.effect("discovers the project tier before xdg", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(cwd, { recursive: true }));
			const winner = join(cwd, "okfit.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "project"\n', "utf8"));
			yield* Effect.promise(() => mkdir(join(root, "xdg", "okfit"), { recursive: true }));
			yield* Effect.promise(() =>
				writeFile(join(root, "xdg", "okfit", "config.toml"), 'bundle.path = "xdg"\n', "utf8"),
			);

			const sources = yield* discoverIn(root, { discoveryCwd: cwd });

			assert.strictEqual(sources[0]?.path, winner);
			assert.strictEqual(sources[0]?.resolver, "project");
			assert.strictEqual(sources[0]?.match?.dir, cwd);
			assert.strictEqual(sources[0]?.value.bundle?.path, "project");
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("in one directory, .okfit.toml beats okfit.toml beats .config/okfit.toml", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(join(cwd, ".config"), { recursive: true }));
			const winner = join(cwd, ".okfit.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "dot"\n', "utf8"));
			yield* Effect.promise(() => writeFile(join(cwd, "okfit.toml"), 'bundle.path = "plain"\n', "utf8"));
			yield* Effect.promise(() => writeFile(join(cwd, ".config", "okfit.toml"), 'bundle.path = "cfg"\n', "utf8"));

			const sources = yield* discoverIn(root, { discoveryCwd: cwd });

			assert.strictEqual(sources[0]?.path, winner);
			assert.strictEqual(sources[0]?.resolver, "project");
			assert.strictEqual(sources[0]?.match?.dir, cwd);
			assert.strictEqual(sources[0]?.value.bundle?.path, "dot");
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("okfit.toml beats .config/okfit.toml in one directory when no dotfile is present", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(join(cwd, ".config"), { recursive: true }));
			const winner = join(cwd, "okfit.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "plain"\n', "utf8"));
			yield* Effect.promise(() => writeFile(join(cwd, ".config", "okfit.toml"), 'bundle.path = "cfg"\n', "utf8"));

			const sources = yield* discoverIn(root, { discoveryCwd: cwd });

			assert.strictEqual(sources[0]?.path, winner);
			assert.strictEqual(sources[0]?.match?.dir, cwd);
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect(".config/okfit.toml anchors its match.dir at the PARENT of .config", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(join(cwd, ".config"), { recursive: true }));
			const winner = join(cwd, ".config", "okfit.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "cfg"\n', "utf8"));

			const sources = yield* discoverIn(root, { discoveryCwd: cwd });

			assert.strictEqual(sources[0]?.path, winner);
			assert.strictEqual(sources[0]?.resolver, "project");
			assert.strictEqual(sources[0]?.match?.dir, cwd);
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("a child's okfit.toml beats a parent's .okfit.toml (directory-major precedence)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const parent = join(root, "project");
			const child = join(parent, "child");
			yield* Effect.promise(() => mkdir(child, { recursive: true }));
			yield* Effect.promise(() => writeFile(join(parent, ".okfit.toml"), 'bundle.path = "parent"\n', "utf8"));
			const winner = join(child, "okfit.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "child"\n', "utf8"));

			const sources = yield* discoverIn(root, { discoveryCwd: child });

			assert.strictEqual(sources[0]?.path, winner);
			assert.strictEqual(sources[0]?.match?.dir, child);
			assert.strictEqual(sources[0]?.value.bundle?.path, "child");
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	// K-63/C-1: `Walker.findUpward`'s own test proved this for the deleted
	// hand-rolled `projectResolver`; `ConfigResolver.upwardWalk`'s error
	// channel is `never` by the interface's own contract
	// (`ConfigResolver<R>.resolve: Effect.Effect<Option.Option<string>, never, R>`),
	// so if the underlying walk does not absorb an ENOTDIR the same way,
	// this fails as a DEFECT rather than a typed error and the `it.effect`
	// itself throws — that would be a finding against the brief's stated
	// semantics, not a bug in this test. Left in (not deleted) per the brief;
	// unskip once confirmed either way.
	it.effect("absorbs an unreadable directory on the way up rather than failing", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(cwd, { recursive: true }));
			// A regular FILE where a directory is expected: every `exists` under it
			// fails with ENOTDIR, deterministic on every platform and uid, unlike a
			// chmod-000 directory which a root-owned CI container ignores.
			const blocked = join(root, "blocked");
			yield* Effect.promise(() => writeFile(blocked, "not a directory\n", "utf8"));
			const winner = join(root, "okfit.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "root"\n', "utf8"));

			const sources = yield* discoverIn(root, { discoveryCwd: join(blocked, "unreachable") });

			assert.strictEqual(sources[0]?.path, winner);
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("discovers xdg before the native directory", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(cwd, { recursive: true }));
			yield* Effect.promise(() => mkdir(join(root, "xdg", "okfit"), { recursive: true }));
			const winner = join(root, "xdg", "okfit", "config.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "xdg"\n', "utf8"));
			const nativeDir = join(root, "home", "Library", "Application Support", "okfit");
			yield* Effect.promise(() => mkdir(nativeDir, { recursive: true }));
			yield* Effect.promise(() => writeFile(join(nativeDir, "config.toml"), 'bundle.path = "native"\n', "utf8"));

			const sources = yield* discoverIn(root, { discoveryCwd: cwd });

			assert.strictEqual(sources[0]?.path, winner);
			assert.strictEqual(sources[0]?.resolver, "xdg");
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("discovers /etc/okfit/config.toml last", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(cwd, { recursive: true }));
			const etc = join(root, "etc");
			yield* Effect.promise(() => mkdir(join(etc, "okfit"), { recursive: true }));
			const winner = join(etc, "okfit", "config.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "system"\n', "utf8"));

			const sources = yield* discoverIn(root, { discoveryCwd: cwd, systemConfigDir: etc });

			assert.strictEqual(sources[0]?.path, winner);
			assert.strictEqual(sources[0]?.resolver, "system");
			assert.strictEqual(sources[0]?.value.bundle?.path, "system");
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("uses only the explicit path when --config is given", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(cwd, { recursive: true }));
			yield* Effect.promise(() => writeFile(join(cwd, "okfit.toml"), 'bundle.path = "project"\n', "utf8"));
			const explicit = join(root, "elsewhere.toml");
			yield* Effect.promise(() => writeFile(explicit, 'bundle.path = "explicit"\n', "utf8"));

			const sources = yield* Effect.gen(function* () {
				const configFile = yield* OkfitConfigFile;
				return yield* configFile.discover;
			}).pipe(
				Effect.provide(buildConfigLayer({ explicitConfigPath: Option.some(explicit), discoveryCwd: cwd })),
				Effect.provide(testEnvAt(root)),
			);

			assert.strictEqual(sources.length, 1);
			assert.strictEqual(sources[0]?.path, explicit);
			assert.strictEqual(sources[0]?.resolver, "explicit");
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("the explicit branch probes no XDG file even when one exists (xdg: false)", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(cwd, { recursive: true }));
			yield* Effect.promise(() => mkdir(join(root, "xdg", "okfit"), { recursive: true }));
			yield* Effect.promise(() =>
				writeFile(join(root, "xdg", "okfit", "config.toml"), 'bundle.path = "xdg"\n', "utf8"),
			);
			const explicit = join(root, "elsewhere.toml");
			yield* Effect.promise(() => writeFile(explicit, 'bundle.path = "explicit"\n', "utf8"));

			const sources = yield* Effect.gen(function* () {
				const configFile = yield* OkfitConfigFile;
				return yield* configFile.discover;
			}).pipe(
				Effect.provide(buildConfigLayer({ explicitConfigPath: Option.some(explicit), discoveryCwd: cwd })),
				Effect.provide(testEnvAt(root)),
			);

			assert.strictEqual(sources.length, 1);
			assert.strictEqual(sources[0]?.path, explicit);
			assert.strictEqual(sources[0]?.resolver, "explicit");
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("resolves the xdg tier at $XDG_CONFIG_HOME/okfit/config.toml", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const cwd = join(root, "project");
			yield* Effect.promise(() => mkdir(cwd, { recursive: true }));
			yield* Effect.promise(() => mkdir(join(root, "xdg", "okfit"), { recursive: true }));
			// C-4/J-1: the filename inside the namespaced directory is config.toml,
			// NOT okfit.toml. A regression here silently orphans every existing
			// personal-defaults file.
			yield* Effect.promise(() =>
				writeFile(join(root, "xdg", "okfit", "okfit.toml"), 'bundle.path = "wrong"\n', "utf8"),
			);
			const winner = join(root, "xdg", "okfit", "config.toml");
			yield* Effect.promise(() => writeFile(winner, 'bundle.path = "right"\n', "utf8"));

			const sources = yield* discoverIn(root, { discoveryCwd: cwd });

			assert.strictEqual(sources[0]?.path, winner);
			assert.strictEqual(sources[0]?.value.bundle?.path, "right");
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
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

	it.effect(
		"wraps a ConfigCodecError from an explicit --config into ConfigMalformedError with that path (K-46 fix round 1)",
		() =>
			Effect.gen(function* () {
				const dir = yield* Effect.promise(makeTempDir);
				const badConfigPath = join(dir, "bad.toml");
				yield* Effect.promise(() => writeFile(badConfigPath, `[bundle\npath = "okf"\n`, "utf8"));
				const program = Effect.gen(function* () {
					const configFile = yield* OkfitConfigFile;
					return yield* configFile.discover;
				});
				const result = yield* program
					.pipe(provideConfig({ explicitConfigPath: Option.some(badConfigPath), discoveryCwd: dir }))
					.pipe(Effect.provide(testEnv), Effect.flip);
				assert.isTrue(result instanceof ConfigMalformedError);
				assert.strictEqual((result as ConfigMalformedError).path, badConfigPath);
				assert.strictEqual(
					(result as ConfigMalformedError).message,
					`malformed config ${badConfigPath}: toml parse failed`,
				);
				yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
			}),
	);

	it.effect(
		"wraps a ConfigCodecError from a DISCOVERED file (no --config) into ConfigMalformedError with its path (K-63)",
		() =>
			Effect.gen(function* () {
				const dir = yield* Effect.promise(makeTempDir);
				const badConfigPath = join(dir, "okfit.toml");
				yield* Effect.promise(() => writeFile(badConfigPath, `[bundle\npath = "okf"\n`, "utf8"));
				const program = Effect.gen(function* () {
					const configFile = yield* OkfitConfigFile;
					return yield* configFile.discover;
				});
				const result = yield* program
					.pipe(provideConfig({ explicitConfigPath: Option.none(), discoveryCwd: dir }))
					.pipe(Effect.provide(testEnv), Effect.flip);
				assert.isTrue(result instanceof ConfigMalformedError);
				assert.strictEqual((result as ConfigMalformedError).path, badConfigPath);
				assert.strictEqual(
					(result as ConfigMalformedError).message,
					`malformed config ${badConfigPath}: toml parse failed`,
				);
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
			const flatPath = join(dir, "okfit.toml");
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
