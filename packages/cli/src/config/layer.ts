import { AppConfig } from "@effected/app";
import { ConfigFile, ConfigResolver, MergeStrategy, TomlCodec } from "@effected/config-file";
import type { AppDirs, Xdg } from "@effected/xdg";
import { OkfitConfig, OkfitConfigFile } from "@okfit/core";
import type { Path, PlatformError } from "effect";
import { Effect, FileSystem, Layer, Option } from "effect";
import { ConfigPathNotFoundError } from "../errors.js";

/**
 * The `OkfitConfigFile` layer for one invocation (K-9 to K-11, K-57). Two
 * shapes, not one chain with a conditional resolver list:
 *
 * - `explicitConfigPath` is `Some`: `ConfigFile.layer` directly, with only
 *   `ConfigResolver.explicitPath(path)`. NOT `AppConfig.layer`: that always
 *   appends `XdgConfig.resolver`/`XdgConfig.nativeResolver` after the
 *   caller's resolvers, and K-10 requires no XDG probe once `--config` is
 *   given.
 * - `explicitConfigPath` is `None`: `AppConfig.layer`, whose two project-local
 *   `upwardWalk` resolvers lead and whose own XDG pair is appended
 *   automatically. `filename: "config.toml"` with the `"okfit"` `AppDirs`
 *   namespace (provided ambiently by `bin.ts`) puts the personal-defaults
 *   file at `$XDG_CONFIG_HOME/okfit/config.toml` (K-11).
 *
 * `discoveryCwd` is `[path]` when given, else `process.cwd()` (K-2), passed
 * as `upwardWalk`'s own `cwd` so nothing in this module reads the process.
 *
 * The explicit branch's inferred `R` (`FileSystem.FileSystem | Path.Path`)
 * is narrower than the discovery branch's (`... | AppDirs | Xdg`); the
 * return type is widened to the union of both, since widening an unused `R`
 * is always safe. `App.layer`, `AppStore` and `AppCache` appear nowhere, so
 * no `store.db`/`cache.db` is ever created (K-9).
 *
 * @public
 */
export const buildConfigLayer = (options: {
	readonly explicitConfigPath: Option.Option<string>;
	readonly discoveryCwd: string;
}): Layer.Layer<OkfitConfigFile, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg> =>
	Layer.unwrap(
		Effect.succeed(
			Option.isSome(options.explicitConfigPath)
				? (ConfigFile.layer(OkfitConfigFile, {
						schema: OkfitConfig,
						codec: TomlCodec,
						resolvers: [ConfigResolver.explicitPath(options.explicitConfigPath.value)],
						strategy: MergeStrategy.firstMatch(),
					}) as Layer.Layer<OkfitConfigFile, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg>)
				: AppConfig.layer(OkfitConfigFile, {
						filename: "config.toml",
						schema: OkfitConfig,
						codec: TomlCodec,
						resolvers: [
							ConfigResolver.upwardWalk({
								filename: "config.toml",
								subpaths: [".config/okfit"],
								cwd: options.discoveryCwd,
							}),
							ConfigResolver.upwardWalk({ filename: "okfit.config.toml", cwd: options.discoveryCwd }),
						],
					}),
		),
	);

/**
 * The K-1 pre-flight and the provide, in that order and in one place: stat
 * `explicitConfigPath` with `FileSystem.exists` and fail with
 * `ConfigPathNotFoundError` BEFORE `buildConfigLayer` is called at all. This
 * is why the CLI does not use `Command.provide(cmd, (input) => layer)`,
 * which would construct the layer first (Judge notes 9) — here the stat
 * runs as the first step of one `Effect.gen`, and `buildConfigLayer` is only
 * reached, and only then actually run, on the step after it.
 *
 * `FileSystem.FileSystem.exists` is `(path: string) => Effect.Effect<boolean, PlatformError>`
 * (`EF/FileSystem.ts:143-145`), not infallible, so
 * `PlatformError.PlatformError` joins the error channel here (decision 7):
 * an unusual stat failure (e.g. a permission error on a parent directory)
 * renders through `renderFailure`'s catch-all rule rather than being
 * uncatchable by the type checker.
 *
 * @public
 */
export const provideConfig =
	(options: { readonly explicitConfigPath: Option.Option<string>; readonly discoveryCwd: string }) =>
	<A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<
		A,
		E | ConfigPathNotFoundError | PlatformError.PlatformError,
		Exclude<R, OkfitConfigFile> | FileSystem.FileSystem | Path.Path | AppDirs | Xdg
	> =>
		Effect.gen(function* () {
			if (Option.isSome(options.explicitConfigPath)) {
				const path = options.explicitConfigPath.value;
				const fs = yield* FileSystem.FileSystem;
				const exists = yield* fs.exists(path);
				if (!exists) {
					return yield* Effect.fail(new ConfigPathNotFoundError({ path }));
				}
			}
			return yield* effect.pipe(Effect.provide(buildConfigLayer(options)));
		});
