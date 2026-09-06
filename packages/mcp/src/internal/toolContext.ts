import type { AppDirs, Xdg } from "@effected/xdg";
import type { ResolvedProjectConfig } from "@okfit/cli";
import { provideConfig, resolveProjectConfig } from "@okfit/cli";
import type { LoadedBundle, OkfitConfig } from "@okfit/core";
import { Bundle } from "@okfit/core";
import type { FileSystem, Path } from "effect";
import { Effect, Option } from "effect";
import { BundleNotFound, ConfigError, composeRemediatedMessage } from "../errors.js";

/**
 * The error's `message` when it has one as a string, else `String(error)`.
 * A four-line local copy of `CLI/render/json.ts`'s own helper, which is
 * module-private there and cannot be imported.
 */
export const messageOf = (error: unknown): string => {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { readonly message: unknown }).message;
		if (typeof message === "string") return message;
	}
	return String(error);
};

const CONFIG_HINT =
	"Check the project's okfit.config.toml or .config/okfit/config.toml for a syntax or schema error; remove it to fall back to defaults.";

/**
 * Config resolution alone, with every failure collapsed to `ConfigError`.
 * `describe_vocabulary` and `validate_bundle` use this; every other tool
 * goes through {@link loadToolContext}.
 *
 * The requirement union (`FileSystem.FileSystem | Path.Path | AppDirs | Xdg`)
 * is inlined here rather than named, so API Extractor never needs a local
 * type alias exported from the package's entry point (K-32-adjacent; a
 * private `ToolServices` alias failed `ae-forgotten-export` at the entry
 * point in this task's own build).
 *
 * @public
 */
export const resolveConfigOnly = (
	projectRoot: string,
): Effect.Effect<ResolvedProjectConfig, ConfigError, FileSystem.FileSystem | Path.Path | AppDirs | Xdg> =>
	resolveProjectConfig({
		pathArg: Option.none(),
		explicitConfigPath: Option.none(),
		cwd: projectRoot,
	}).pipe(
		provideConfig({ explicitConfigPath: Option.none(), discoveryCwd: projectRoot }),
		Effect.mapError((cause) => {
			const remediation = { hint: CONFIG_HINT, suggestedTool: "describe_vocabulary" };
			return new ConfigError({
				message: composeRemediatedMessage(messageOf(cause), remediation),
				remediation,
			});
		}),
	);

/** Everything a tool needs about the project, reloaded on every call (N-9). @public */
export interface ToolContext {
	readonly projectRoot: string;
	readonly bundleRoot: string;
	readonly config: OkfitConfig;
	readonly profile: ResolvedProjectConfig["profile"];
	readonly bundle: LoadedBundle;
}

/**
 * Resolve config and load the bundle, fresh, for one tool call (N-9). No
 * cache and no `reload` tool: correct under mid-session edits, trivially
 * testable, and the bundles in scope are small.
 *
 * @public
 */
export const loadToolContext = (
	projectRoot: string,
): Effect.Effect<ToolContext, ConfigError | BundleNotFound, FileSystem.FileSystem | Path.Path | AppDirs | Xdg> =>
	Effect.gen(function* () {
		const resolved = yield* resolveConfigOnly(projectRoot);
		const bundle = yield* Bundle.load({ root: resolved.bundleRoot }).pipe(
			Effect.mapError((cause) => {
				const remediation = {
					hint: `The bundle root "${resolved.bundleRoot}" does not exist or could not be read; check the config's [bundle].path, or run \`okfit init\`.`,
				};
				return new BundleNotFound({
					root: resolved.bundleRoot,
					message: composeRemediatedMessage(cause.message, remediation),
					remediation,
				});
			}),
		);
		return {
			projectRoot,
			bundleRoot: resolved.bundleRoot,
			config: resolved.config,
			profile: resolved.profile,
			bundle,
		};
	});
