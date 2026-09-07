import {
	ConfigCodecError,
	ConfigFile,
	ConfigResolver,
	ConfigValidationError,
	MergeStrategy,
	TomlCodec,
} from "@effected/config-file";
import type { Xdg } from "@effected/xdg";
import { AppDirs, XdgConfig } from "@effected/xdg";
import { OkfitConfig, OkfitConfigFile } from "@okfit/core";
import type { Path, PlatformError } from "effect";
import { Cause, Effect, FileSystem, Layer, Option, Result } from "effect";
import { ConfigMalformedError, ConfigPathNotFoundError } from "../errors.js";
import { projectResolver } from "./projectResolver.js";

/**
 * The `OkfitConfigFile` layer for one invocation (K-9 to K-11, K-57, C-6).
 * Two shapes, not one chain with a conditional resolver list:
 *
 * - `explicitConfigPath` is `Some`: `ConfigFile.layer` directly, with only
 *   `ConfigResolver.explicitPath(path)`. NOT `AppConfig.layer`: that always
 *   appends `XdgConfig.resolver`/`XdgConfig.nativeResolver` after the
 *   caller's resolvers, and K-10 requires no XDG probe once `--config` is
 *   given.
 * - `explicitConfigPath` is `None`: `ConfigFile.layer` directly, with four
 *   resolvers in order — the hand-rolled `projectResolver` (per directory:
 *   `.okfit.toml`, `okfit.toml`, `.config/okfit.toml`, ascending to the
 *   filesystem root), `XdgConfig.resolver`, `XdgConfig.nativeResolver`,
 *   then `ConfigResolver.systemEtc`. NOT `AppConfig.layer`: it appends its
 *   own XDG pair AFTER the caller's resolvers and offers no hook past them
 *   (`app/src/AppConfig.ts:134-142`), so the system tier C-5 requires
 *   cannot be reached through it. `filename: "config.toml"` at the three
 *   non-project tiers puts personal defaults at
 *   `$XDG_CONFIG_HOME/okfit/config.toml` and system defaults at
 *   `/etc/okfit/config.toml` (C-4, C-5). `defaultPath` is carried over
 *   from what `AppConfig.layer` used to set, so `save`/`update` do not
 *   start failing with `ConfigDefaultPathMissingError`.
 *
 * `discoveryCwd` is `[path]` when given, else `process.cwd()` (K-2), passed
 * as `projectResolver`'s own `cwd` so nothing in this module reads the
 * process.
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
	/**
	 * System config root, defaulting to `/etc`. Overridable primarily so tests
	 * can point at a writable temp directory — the real `/etc` is not writable
	 * in test environments. No production call site sets it.
	 */
	readonly systemConfigDir?: string;
}): Layer.Layer<OkfitConfigFile, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg> =>
	Option.isSome(options.explicitConfigPath)
		? (ConfigFile.layer(OkfitConfigFile, {
				schema: OkfitConfig,
				codec: TomlCodec,
				resolvers: [ConfigResolver.explicitPath(options.explicitConfigPath.value)],
				strategy: MergeStrategy.firstMatch(),
			}) as Layer.Layer<OkfitConfigFile, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg>)
		: Layer.unwrap(
				Effect.gen(function* () {
					const appDirs = yield* AppDirs;
					// TS infers a resolver array's `RR` from the FIRST element and will
					// not union in the rest (the same gotcha `AppConfig.layer` itself
					// documents, `app/src/AppConfig.ts:126-127`), so the chain is
					// annotated up front rather than left to inference.
					const resolvers: ReadonlyArray<ConfigResolver<FileSystem.FileSystem | Path.Path | AppDirs | Xdg>> = [
						projectResolver({ cwd: options.discoveryCwd }),
						XdgConfig.resolver({ filename: "config.toml" }),
						XdgConfig.nativeResolver({ namespace: appDirs.namespace, filename: "config.toml" }),
						ConfigResolver.systemEtc({
							app: "okfit",
							filename: "config.toml",
							...(options.systemConfigDir !== undefined ? { dir: options.systemConfigDir } : {}),
						}),
					];
					return ConfigFile.layer(OkfitConfigFile, {
						schema: OkfitConfig,
						codec: TomlCodec,
						strategy: MergeStrategy.firstMatch(),
						resolvers,
						defaultPath: XdgConfig.savePath("config.toml"),
					});
				}),
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
 * K-46 fix round 1: a `ConfigCodecError`/`ConfigValidationError` from
 * `buildConfigLayer`'s provided layer is wrapped into `ConfigMalformedError`
 * whenever the failing path is known, so `renderFailure` can name it:
 *
 * - `ConfigCodecError` carries no `path` field at all (checked against the
 *   installed `.d.ts`) — the only path we can ever attach for one is
 *   `explicitConfigPath` itself, when `--config` named it directly. In the
 *   discovery branch (no `--config`) a `ConfigCodecError` passes through
 *   unwrapped: several candidate files are tried and nothing in this module
 *   or the library says which one failed.
 * - `ConfigValidationError` carries its own `path: Option<string>` — used
 *   when present (either branch), falling back to `explicitConfigPath` when
 *   the library's own `path` is `None` and `--config` was given.
 *
 * @public
 */
export const provideConfig =
	(options: {
		readonly explicitConfigPath: Option.Option<string>;
		readonly discoveryCwd: string;
		readonly systemConfigDir?: string;
	}) =>
	<A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<
		A,
		E | ConfigPathNotFoundError | ConfigMalformedError | PlatformError.PlatformError,
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
			// `provideConfig` is generic over `E`, so `catchIf`/`catchTag`'s
			// `EB extends E` constraint cannot be proven inside this function body
			// even though `OkfitConfigFile#discover`'s real error channel
			// (`ConfigReadError = ConfigFileReadError | ConfigCodecError |
			// ConfigValidationError`) is part of `E` for every real caller.
			// `Effect.catchCause` sidesteps that: it hands over the whole `Cause<E>`
			// with no narrowing constraint, `Cause.findFail` pulls out the first
			// typed failure (if there is one — a defect or interrupt has none), and
			// anything that is not one of the two library errors, or whose path is
			// unknown, re-fails the ORIGINAL cause unchanged via `Effect.failCause`
			// (never `Effect.fail`, so defects/interrupts are never downgraded to a
			// typed failure).
			return yield* effect.pipe(
				Effect.provide(buildConfigLayer(options)),
				Effect.catchCause((cause): Effect.Effect<never, E | ConfigMalformedError, never> => {
					const found = Cause.findFail(cause);
					if (Result.isSuccess(found)) {
						const error = found.success.error;
						if (error instanceof ConfigCodecError && Option.isSome(options.explicitConfigPath)) {
							return Effect.fail(new ConfigMalformedError({ path: options.explicitConfigPath.value, cause: error }));
						}
						if (error instanceof ConfigValidationError) {
							const path = Option.isSome(options.explicitConfigPath) ? options.explicitConfigPath : error.path;
							if (Option.isSome(path)) {
								return Effect.fail(new ConfigMalformedError({ path: path.value, cause: error }));
							}
						}
					}
					// K-46: either not one of the two library errors, or (a
					// `ConfigCodecError` during discovery) a path genuinely cannot be
					// attached — several candidates are tried and nothing names which
					// one failed.
					return Effect.failCause(cause);
				}),
			);
		});
