import { CliInteractive, Doc } from "@effected/cli";
import { CurrentDistribution } from "@effected/engine";
import { Git } from "@effected/git";
import { OKF_SPEC_VERSION } from "@okfit/core";
import {
	Now,
	StaleEnvelope,
	VerifySelectionError,
	jsonError,
	provideConfig,
	resolveProjectConfig,
	runStale,
	staleEnvelope,
} from "@okfit/engine";
import { Console, DateTime, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { displayRoot } from "../render/human.js";
import { humanStaleDoc, staleSummary } from "../render/stale.js";
import { CLI_VERSION } from "../version.js";
import { reverifyStale } from "./stale-verify.js";

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

const formatFlag = Flag.Literals("format", ["human", "json"] as const).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
);

const verifyFlag = Flag.Boolean("verify").pipe(
	Flag.withDefault(false),
	Flag.withDescription("after the report, pick stale concepts to re-verify and roll their stale_after forward"),
);

const dryRunFlag = Flag.Boolean("dry-run").pipe(
	Flag.withDefault(false),
	Flag.withDescription("with --verify, show what would be written without writing it"),
);

/**
 * `okfit stale [path] [--config <file>] [--format human|json]`.
 *
 * Same handler skeleton as `commands/validate.ts`/`commands/context.ts` —
 * stat `--config` (K-1) via `provideConfig`, resolve the project and
 * bundle roots through `resolveProjectConfig` — then it diverges:
 * `@okfit/engine`'s `runStale` (`Bundle.load` then
 * `Derive.staleReport(bundle, now)`), render, and always exit `0`: this is
 * a report, not a check, and the `stale` lint rule (part of `okfit
 * validate`/`okfit lint`) is where staleness fails a run.
 *
 * @public
 */
export const staleCommand = Command.make(
	"stale",
	{ path: pathArg, config: configFlag, format: formatFlag, verify: verifyFlag, dryRun: dryRunFlag },
	(input) =>
		Effect.gen(function* () {
			const cwd = process.cwd();
			const discoveryCwd = Option.getOrElse(input.path, () => cwd);
			const now = yield* Now;
			const path = yield* Path.Path;
			const distribution = yield* CurrentDistribution;

			const body = Effect.gen(function* () {
				// Decide before loading the bundle or printing anything: a run that
				// cannot mount a screen (agent/ci audience, a pipe, --format json) is a
				// plain 64, exactly as for bare `okfit verify`.
				if (input.dryRun && !input.verify) return yield* new VerifySelectionError({ reason: "dry-run-needs-verify" });
				if (input.verify && !(yield* CliInteractive)) {
					return yield* new VerifySelectionError({ reason: "no-selection" });
				}
				const resolved = yield* resolveProjectConfig({
					pathArg: input.path,
					explicitConfigPath: input.config,
					cwd,
				});
				const { bundleRoot, config: merged, profile } = resolved;

				const result = yield* runStale({ root: bundleRoot, now });
				const envelope = staleEnvelope({
					okfitVersion: CLI_VERSION,
					producer: "okfit",
					okfVersion: merged.okf_version ?? OKF_SPEC_VERSION,
					root: bundleRoot,
					profile: Option.match(profile, { onNone: () => null, onSome: (p) => p.name }),
					now,
					concepts: result.bundle.concepts.size,
					items: result.items,
					// exactOptionalPropertyTypes: omit the key rather than set it to undefined.
					...(Option.isSome(distribution) ? { distribution: distribution.value } : {}),
				});

				if (input.format === "json") {
					yield* Console.log(JSON.stringify(Schema.encodeSync(StaleEnvelope)(envelope)));
				} else {
					yield* Doc.print(humanStaleDoc(envelope.items, { root: bundleRoot }));
					yield* Console.error(
						staleSummary(envelope.summary.stale, envelope.summary.concepts, displayRoot(cwd, bundleRoot, path)),
					);
					if (input.verify) {
						yield* reverifyStale({
							bundleRoot,
							projectRoot: resolved.projectRoot,
							config: resolved.config,
							now,
							// Whole seconds: the attestation `at` is written without fractional digits, like every other `at`.
							at: DateTime.startOf(now, "second"),
							dryRun: input.dryRun,
						}).pipe(
							Effect.catchTag("NotInteractive", () =>
								Effect.fail(new VerifySelectionError({ reason: "no-selection" })),
							),
						);
					}
				}
			}).pipe(
				Effect.provide(Git.layer),
				provideConfig({ explicitConfigPath: input.config, discoveryCwd }),
				// #217: machine output never prompts. Narrows only.
				CliInteractive.unless(input.format === "json"),
			);

			// K-22: under --format json, an infrastructure failure ALSO gets a stdout
			// envelope, reusing @okfit/engine's render/json.ts#jsonError unchanged —
			// the same idiom validate.ts/context.ts/verify.ts/sync.ts already share.
			if (input.format === "json") {
				return yield* body.pipe(
					Effect.tapError((error) =>
						Console.log(JSON.stringify(jsonError(error, CLI_VERSION, Option.getOrUndefined(distribution)))),
					),
				);
			}
			return yield* body;
		}),
).pipe(
	Command.withDescription(
		"List every concept whose stale_after instant has passed as of now, with how many whole days past it.",
	),
);
