import { Git } from "@effected/git";
import { OKF_SPEC_VERSION } from "@okfit/core";
import {
	JsonEnvelope,
	Now,
	collect,
	forDiagnostics,
	json,
	jsonError,
	provideConfig,
	resolveProjectConfig,
	run,
} from "@okfit/engine";
import { GitHistory } from "@okfit/profiles";
import { Console, Effect, Layer, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { setExitCode } from "../internal/exit.js";
import { useColor } from "../internal/tty.js";
import type { Counts } from "../render/human.js";
import { displayRoot, human, summary } from "../render/human.js";
import { CLI_VERSION } from "../version.js";

/** `[path]` is the PROJECT root (K-2), never the bundle root. Absolute at parse time (K-50). */
const pathArg = Argument.Path("path", { pathType: "directory" }).pipe(
	Argument.optional,
	Argument.withDescription(
		"project root to start config discovery from (default: current directory); never the bundle root",
	),
);

/** K-1: no `mustExist` — the handler stats the path itself, before building any layer. */
const configFlag = Flag.File("config").pipe(
	Flag.optional,
	Flag.withDescription("explicit config file; skips discovery"),
);

/** K-6: `--format` is on `validate` only. */
const formatFlag = Flag.Literals("format", ["human", "json"] as const).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
);

/** S-31: skips `Provenance.lint`'s git tier for this invocation, without touching `[lint]`. */
const skipProvenanceFlag = Flag.Boolean("skip-provenance").pipe(
	Flag.withDefault(false),
	Flag.withDescription("skip the generated-at-drift lint's git tier for this run"),
);

/**
 * `okfit validate [path] [--config <file>] [--format human|json] [--skip-provenance]`.
 *
 * Handler order fixed by the contract (§2 `src/commands/validate.ts`):
 * stat `--config` (K-1) via `provideConfig`, discover (`OkfitConfigFile.discover`),
 * resolve the profile with the K-4 warning, merge `DEFAULTS < profile < file`
 * (D-28), warn on an `okf_version` mismatch (K-15), resolve the project and
 * bundle roots (K-12), run (`@okfit/engine`'s `validate/run.ts#run`), collect and sort the
 * diagnostics, render per `--format` (K-18, K-20 to K-22), and set the exit
 * code without failing the Effect (K-7, K-8).
 *
 * @public
 */
export const validateCommand = Command.make(
	"validate",
	{ path: pathArg, config: configFlag, format: formatFlag, skipProvenance: skipProvenanceFlag },
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();
			const discoveryCwd = Option.getOrElse(input.path, () => cwd);
			const now = yield* Now;
			const path = yield* Path.Path;

			const body = Effect.gen(function* () {
				const resolved = yield* resolveProjectConfig({
					pathArg: input.path,
					explicitConfigPath: input.config,
					cwd,
				});
				const { bundleRoot, config: merged, profile } = resolved;

				const result = yield* run({
					root: bundleRoot,
					config: merged,
					profile,
					now,
					skipProvenance: input.skipProvenance,
				}).pipe(Effect.provide(Layer.mergeAll(Git.layer, GitHistory.layer)));
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
