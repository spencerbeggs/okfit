import type { ConfigReadError } from "@effected/config-file";
import { OKF_SPEC_VERSION, OkfitConfig, OkfitConfigFile } from "@okfit/core";
import type { Profile } from "@okfit/profiles";
import { Profiles } from "@okfit/profiles";
import { Console, Effect, Option, Path } from "effect";
import type { DiscoveredConfig } from "./anchor.js";
import { resolveBundleRoot, resolveProjectRoot } from "./anchor.js";

/**
 * `OkfitConfig.DEFAULTS.bundle.profile` is `"software-project"` at runtime
 * (the frozen literal always sets it), but `bundle` and `profile` are both
 * `optionalKey` in the schema, so the type checker sees `string | undefined`
 * two levels deep. The `?? "software-project"` fallback here is unreachable
 * in practice; it exists only to satisfy `noUncheckedIndexedAccess`-style
 * strictness without a non-null assertion. Formerly duplicated identically
 * in `commands/validate.ts` and `commands/context.ts`; this is its one home
 * now that both commands delegate to {@link resolveProjectConfig}.
 *
 * @public
 */
export const DEFAULT_PROFILE_NAME = OkfitConfig.DEFAULTS.bundle?.profile ?? "software-project";

/**
 * Everything `validate` and `context`'s handlers derive from config
 * discovery before diverging (contract §8.3): the merged config, the
 * resolved profile (and its name after the "none"/default rule), the
 * discovery source (if any), and the project/bundle roots.
 *
 * @public
 */
export interface ResolvedProjectConfig {
	readonly projectRoot: string;
	readonly bundleRoot: string;
	readonly config: OkfitConfig;
	readonly profile: Option.Option<Profile>;
	readonly profileName: string;
	readonly discovered: Option.Option<DiscoveredConfig>;
}

/**
 * Input to {@link resolveProjectConfig}: the same three values every command
 * handler already has in hand (its own `[path]` argument, its own
 * `--config` flag, and `process.cwd()`) — nothing this function needs is
 * read from `process` itself.
 *
 * @public
 */
export interface ResolveProjectConfigInput {
	readonly pathArg: Option.Option<string>;
	readonly explicitConfigPath: Option.Option<string>;
	readonly cwd: string;
}

/**
 * The config-resolution step byte-identical between `validate` and
 * `context`'s handlers (A2 review finding): discover, pick `sources[0]`,
 * default `{ extensions: {} }`, resolve the profile name and the K-4
 * unknown-profile warning, merge `DEFAULTS < profile < file` (D-28), warn on
 * an `okf_version` mismatch (K-15), then resolve the project and bundle
 * roots (K-12). Every message string and the merge order are unchanged from
 * the two commands' former inline copies.
 *
 * @public
 */
export const resolveProjectConfig = (
	input: ResolveProjectConfigInput,
): Effect.Effect<ResolvedProjectConfig, ConfigReadError, OkfitConfigFile | Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const okfitConfigFile = yield* OkfitConfigFile;
		const sources = yield* okfitConfigFile.discover;
		const discoveredSource = sources[0];
		const fileConfig: OkfitConfig = discoveredSource === undefined ? { extensions: {} } : discoveredSource.value;

		const profileName = fileConfig.bundle?.profile ?? DEFAULT_PROFILE_NAME;
		const profile = profileName === "none" ? Option.none() : Profiles.get(profileName);
		if (profileName !== "none" && Option.isNone(profile)) {
			yield* Console.error(`warning: unknown profile "${profileName}"; continuing with defaults`);
		}

		const base = Option.match(profile, {
			onNone: () => OkfitConfig.DEFAULTS,
			onSome: (p) => OkfitConfig.merge(OkfitConfig.DEFAULTS, p.config),
		});
		const merged = OkfitConfig.merge(base, fileConfig);

		if (merged.okf_version !== undefined && merged.okf_version !== OKF_SPEC_VERSION) {
			yield* Console.error(
				`warning: okf_version "${merged.okf_version}" does not match this okfit's spec version "${OKF_SPEC_VERSION}"; continuing`,
			);
		}

		const discovered: Option.Option<DiscoveredConfig> =
			discoveredSource === undefined
				? Option.none()
				: Option.some({ path: discoveredSource.path, resolver: discoveredSource.resolver });
		const projectRoot = resolveProjectRoot({
			pathArg: input.pathArg,
			explicitConfigPath: input.explicitConfigPath,
			discovered,
			cwd: input.cwd,
			path,
		});
		const bundleRoot = resolveBundleRoot(projectRoot, merged, path);

		return { projectRoot, bundleRoot, config: merged, profile, profileName, discovered };
	});
