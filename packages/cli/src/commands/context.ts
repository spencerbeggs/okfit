import { provideConfig, resolveProjectConfig } from "@okfit/engine";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
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

/**
 * `okfit context [path] [--config <file>] [--format human|json]`.
 *
 * Handler order fixed by the contract (§8.3): steps 1–7 are
 * `validateCommand`'s handler in substance (both now share
 * `@okfit/engine`'s `resolveProjectConfig` — A4) — stat `--config` (K-1) via
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

			const body = Effect.gen(function* () {
				const resolved = yield* resolveProjectConfig({
					pathArg: input.path,
					explicitConfigPath: input.config,
					cwd,
				});
				const { projectRoot, bundleRoot, config: merged, profile, profileName, discovered } = resolved;

				const { indexPath, indexExists } = yield* runContext({ bundleRoot });

				// Decision 4: discoveredSource.path when discovery found something
				// (this also covers the --config branch: the explicit-path resolver
				// makes discover() return exactly one source whose path already
				// equals input.config's value); otherwise the --config value itself
				// when given, else null.
				const configPath = Option.match(discovered, {
					onNone: () => (Option.isSome(input.config) ? input.config.value : null),
					onSome: (source) => source.path,
				});

				// Important 1 (final review): profile_requested is null only when
				// no config file was found at all (configPath null); otherwise it is
				// resolveProjectConfig's own profileName, after the K-4 default
				// rule, regardless of whether that name resolved to a known profile.
				const profileRequested = configPath === null ? null : profileName;

				const envelope = contextEnvelope({
					projectRoot,
					bundleRoot,
					configPath,
					profile: Option.match(profile, { onNone: () => null, onSome: (p) => p.name }),
					profileRequested,
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
