import { OKF_SPEC_VERSION } from "@okfit/core";
import {
	Now,
	StaleEnvelope,
	jsonError,
	provideConfig,
	resolveProjectConfig,
	runStale,
	staleEnvelope,
} from "@okfit/engine";
import { Console, Effect, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { setExitCode } from "../internal/exit.js";
import { displayRoot } from "../render/human.js";
import { humanStale, staleSummary } from "../render/stale.js";
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

const formatFlag = Flag.Literals("format", ["human", "json"] as const).pipe(
	Flag.withDefault("human"),
	Flag.withDescription("output format: human (default) or json"),
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
export const staleCommand = Command.make("stale", { path: pathArg, config: configFlag, format: formatFlag }, (input) =>
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
			});

			if (input.format === "json") {
				yield* Console.log(JSON.stringify(Schema.encodeSync(StaleEnvelope)(envelope)));
			} else {
				for (const line of humanStale(envelope.items)) {
					yield* Console.log(line);
				}
				yield* Console.error(
					staleSummary(envelope.summary.stale, envelope.summary.concepts, displayRoot(cwd, bundleRoot, path)),
				);
			}

			setExitCode(0);
		}).pipe(provideConfig({ explicitConfigPath: input.config, discoveryCwd }));

		// K-22: under --format json, an infrastructure failure ALSO gets a stdout
		// envelope, reusing @okfit/engine's render/json.ts#jsonError unchanged —
		// the same idiom validate.ts/context.ts/verify.ts/sync.ts already share.
		if (input.format === "json") {
			return yield* body.pipe(Effect.tapError((error) => Console.log(JSON.stringify(jsonError(error, CLI_VERSION)))));
		}
		return yield* body;
	}),
).pipe(
	Command.withDescription(
		"List every concept whose stale_after instant has passed as of now, with how many whole days past it.",
	),
);
