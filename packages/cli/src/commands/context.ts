import { OKF_SPEC_VERSION, OkfitConfig, OkfitConfigFile } from "@okfit/core";
import { Profiles } from "@okfit/profiles";
import { Console, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { DiscoveredConfig } from "../config/anchor.js";
import { resolveBundleRoot, resolveProjectRoot } from "../config/anchor.js";
import { provideConfig } from "../config/layer.js";
import { runContext } from "../context/run.js";
import { setExitCode } from "../internal/exit.js";
import { ContextEnvelope, contextEnvelope, humanContext } from "../render/context.js";
import { jsonError } from "../render/json.js";
import { CLI_VERSION } from "../version.js";

/** `[path]` is the PROJECT root (K-2), never the bundle root. Absolute at parse time (K-50). */
const pathArg = Argument.path("path", { pathType: "directory" }).pipe(
	Argument.optional,
	Argument.withDescription(
		"project root to start config discovery from (default: current directory); never the bundle root",
	),
);

/** K-1: no `mustExist` — the handler stats the path itself, before building any layer. */
const configFlag = Flag.file("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

/** No `--profile` flag: M-15's exact ruling; that flag belongs to `init` alone. */
const formatFlag = Flag.choice("format", ["human", "json"] as const).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
);

/** Matches `commands/validate.ts`'s own `DEFAULT_PROFILE_NAME` (decision 1: not shared, not refactored). */
const DEFAULT_PROFILE_NAME = OkfitConfig.DEFAULTS.bundle?.profile ?? "software-project";

/**
 * `okfit context [path] [--config <file>] [--format human|json]`.
 *
 * Handler order fixed by the contract (§8.3): steps 1–7 are
 * `validateCommand`'s handler verbatim — stat `--config` (K-1) via
 * `provideConfig`, discover (`OkfitConfigFile.discover`), resolve the
 * profile with the K-4 warning, merge `DEFAULTS < profile < file` (D-28),
 * warn on an `okf_version` mismatch (K-15), resolve the project and bundle
 * roots (K-12) — then it diverges: `runContext` (index.md stat only,
 * never `Bundle.load`), build the envelope, render, and always exit `0`
 * (there is no content tier: `context` never runs conformance or lint
 * checks, so C-3.5's `1`/`2` codes have no analogue here).
 *
 * @public
 */
export const contextCommand = Command.make(
	"context",
	{ path: pathArg, config: configFlag, format: formatFlag },
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();
			const discoveryCwd = Option.getOrElse(input.path, () => cwd);
			const path = yield* Path.Path;

			const body = Effect.gen(function* () {
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
					pathArg: input.path,
					explicitConfigPath: input.config,
					discovered,
					cwd,
					path,
				});
				const bundleRoot = resolveBundleRoot(projectRoot, merged, path);

				const { indexPath, indexExists } = yield* runContext({ bundleRoot });

				// Decision 4: discoveredSource.path when discovery found something
				// (this also covers the --config branch: the explicit-path resolver
				// makes discover() return exactly one source whose path already
				// equals input.config's value); otherwise the --config value itself
				// when given, else null.
				const configPath =
					discoveredSource === undefined
						? Option.isSome(input.config)
							? input.config.value
							: null
						: discoveredSource.path;

				const envelope = contextEnvelope({
					projectRoot,
					bundleRoot,
					configPath,
					profile: Option.match(profile, { onNone: () => null, onSome: (p) => p.name }),
					indexPath,
					indexExists,
					config: merged,
				});

				if (input.format === "json") {
					yield* Console.log(JSON.stringify(Schema.encodeSync(ContextEnvelope)(envelope)));
				} else {
					for (const contextLine of humanContext(envelope)) {
						yield* Console.log(contextLine);
					}
				}

				setExitCode(0);
			}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

			// K-22: under --format json, an infrastructure failure ALSO gets a stdout
			// envelope, reusing render/json.ts#jsonError unchanged (K-22) — context
			// defines no error envelope of its own.
			if (input.format === "json") {
				return yield* body.pipe(Effect.tapError((error) => Console.log(JSON.stringify(jsonError(error, CLI_VERSION)))));
			}
			return yield* body;
		}),
).pipe(
	Command.withDescription(
		"Print the resolved project root, bundle root, config path, profile, and type/tag vocabulary without loading the bundle.",
	),
);
