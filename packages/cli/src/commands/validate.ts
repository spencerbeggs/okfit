import { OKF_SPEC_VERSION, OkfitConfig, OkfitConfigFile } from "@okfit/core";
import { Profiles } from "@okfit/profiles";
import { Console, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { DiscoveredConfig } from "../config/anchor.js";
import { resolveBundleRoot, resolveProjectRoot } from "../config/anchor.js";
import { provideConfig } from "../config/layer.js";
import { setExitCode } from "../internal/exit.js";
import { useColor } from "../internal/tty.js";
import { forDiagnostics } from "../render/exit.js";
import type { Counts } from "../render/human.js";
import { displayRoot, human, summary } from "../render/human.js";
import { JsonEnvelope, json, jsonError } from "../render/json.js";
import { collect } from "../render/sort.js";
import { Now, run } from "../validate/run.js";
import { CLI_VERSION } from "../version.js";

/** `[path]` is the PROJECT root (K-2), never the bundle root. Absolute at parse time (K-50). */
const pathArg = Argument.path("path", { pathType: "directory" }).pipe(Argument.optional);

/** K-1: no `mustExist` — the handler stats the path itself, before building any layer. */
const configFlag = Flag.file("config").pipe(Flag.optional);

/** K-6: `--format` is on `validate` only. */
const formatFlag = Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human"));

/**
 * `OkfitConfig.DEFAULTS.bundle.profile` is `"software-project"` at runtime
 * (the frozen literal always sets it), but `bundle` and `profile` are both
 * `optionalKey` in the schema, so the type checker sees `string | undefined`
 * two levels deep. The `?? "software-project"` fallback here is unreachable
 * in practice; it exists only to satisfy `noUncheckedIndexedAccess`-style
 * strictness without a non-null assertion.
 */
const DEFAULT_PROFILE_NAME = OkfitConfig.DEFAULTS.bundle?.profile ?? "software-project";

/**
 * `okfit validate [path] [--config <file>] [--format human|json]`.
 *
 * Handler order fixed by the contract (§2 `src/commands/validate.ts`):
 * stat `--config` (K-1) via `provideConfig`, discover (`OkfitConfigFile.discover`),
 * resolve the profile with the K-4 warning, merge `DEFAULTS < profile < file`
 * (D-28), warn on an `okf_version` mismatch (K-15), resolve the project and
 * bundle roots (K-12), run (`validate/run.ts#run`), collect and sort the
 * diagnostics, render per `--format` (K-18, K-20 to K-22), and set the exit
 * code without failing the Effect (K-7, K-8).
 *
 * @public
 */
export const validateCommand = Command.make(
	"validate",
	{ path: pathArg, config: configFlag, format: formatFlag },
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();
			const discoveryCwd = Option.getOrElse(input.path, () => cwd);
			const now = yield* Now;
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

				const result = yield* run({ root: bundleRoot, config: merged, profile, now });
				const diagnostics = collect(result.report.conformance, result.report.lint, result.profileDiagnostics);
				const code = forDiagnostics(diagnostics);

				if (input.format === "json") {
					const envelope = json({
						okfitVersion: CLI_VERSION,
						okfVersion: merged.okf_version ?? OKF_SPEC_VERSION,
						root: bundleRoot,
						profile: Option.match(profile, { onNone: () => null, onSome: (p) => p.name }),
						exitCode: code,
						concepts: result.bundle.concepts.size,
						diagnostics,
					});
					yield* Console.log(JSON.stringify(Schema.encodeSync(JsonEnvelope)(envelope)));
				} else {
					for (const diagnosticLine of human(diagnostics, { color: useColor() })) {
						yield* Console.log(diagnosticLine);
					}
					const counts: Counts = {
						errors: diagnostics.filter((d) => d.severity === "error").length,
						warnings: diagnostics.filter((d) => d.severity === "warning").length,
						info: diagnostics.filter((d) => d.severity === "info").length,
						concepts: result.bundle.concepts.size,
					};
					yield* Console.error(summary(counts, displayRoot(cwd, bundleRoot, path)));
				}

				setExitCode(code);
			}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

			// K-22: under --format json, an infrastructure failure ALSO gets a stdout
			// envelope, alongside the usual stderr rendering CliRuntime.reportFailures
			// does in bin.ts. tapError re-fails unchanged so that rendering still runs.
			if (input.format === "json") {
				return yield* body.pipe(Effect.tapError((error) => Console.log(JSON.stringify(jsonError(error, CLI_VERSION)))));
			}
			return yield* body;
		}),
).pipe(Command.withDescription("Load config and bundle, run conformance and lint checks, and render the diagnostics."));
