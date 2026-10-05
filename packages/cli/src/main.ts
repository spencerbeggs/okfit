/**
 * The assembled okfit CLI program.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { CliAudience, CliRuntime } from "@effected/cli";
import type { Distribution } from "@effected/engine";
import { CurrentDistribution } from "@effected/engine";
import { Now, OkfitPlatform } from "@okfit/engine";
import { DateTime, Effect, Option } from "effect";
import { rootCommand } from "./commands/root.js";
import { renderFailure } from "./errors.js";
import { versionFormatter } from "./internal/versionFormatter.js";
import { CLI_VERSION } from "./version.js";

/**
 * K-47: an ISO-8601 `OKFIT_NOW` when set, else the wall clock. A documented
 * test hook, not user-facing. Resolved exactly once, here, and provided to
 * the whole command tree through the `Now` tag so no command handler ever
 * reads `process.env["OKFIT_NOW"]` itself.
 */
const nowEffect = Option.fromNullishOr(process.env.OKFIT_NOW).pipe(
	Option.flatMap((iso) => DateTime.make(iso)),
	Option.match({ onNone: () => DateTime.now, onSome: Effect.succeed }),
);

/**
 * Options `@okfit/plugin`'s bin shims (and only they, today) pass to
 * {@link main}. `distribution` names the meta-package the `okfit` bin was
 * installed through; omitted (or `undefined`) for a direct install of
 * `@okfit/cli` (okfit #137).
 *
 * @public
 */
export interface MainOptions {
	readonly distribution?: Distribution;
}

/**
 * Run the okfit CLI. Owns the process: installs the runtime teardown and
 * sets the exit code. `NodeRuntime.runMain` does not return a promise.
 *
 * Assembled with `@effected/cli`'s `CliRuntime.main` (`effect-v4-cli`'s
 * `recipes.md#the-main-assembly`), which already provides
 * `platform` INSIDE failure reporting, a fresh `CliExit` cell, and the
 * logger outermost -- the same order this package used to assemble by
 * hand. `CliRuntime.main`/`reportFailures` also already remap a
 * `CliError.ShowHelp` carrying parse errors to `usageExitCode` (64) and
 * leave a bare `--help`/root invocation at 0 (`Command.runWith` has
 * already rendered the help document either way), so the hand-rolled
 * `catchTag("ShowHelp", ...)` remap this package used to carry is gone --
 * it duplicated what the kit's own assembly already does.
 *
 * @public
 */
export const main = (options: MainOptions = {}): void => {
	const distribution = Option.fromNullishOr(options.distribution);

	const program = Effect.gen(function* () {
		const now = yield* nowEffect;
		return yield* CliAudience.run(rootCommand, { version: CLI_VERSION }).pipe(Effect.provideService(Now, now));
	}).pipe(
		// For anything in the command tree that reads the carrier; `--version`'s
		// own formatter takes the distribution directly (`env.formatter`).
		Effect.provideService(CurrentDistribution, distribution),
	);

	NodeRuntime.runMain(
		CliRuntime.main(program, {
			// Provided INSIDE failure reporting, so a failure while building
			// `OkfitPlatform` (an `XdgEnvError` from an unset `HOME`, K-13) is
			// itself rendered and mapped to `exitCode: 3`, rather than escaping to
			// `NodeRuntime.runMain`'s own fatal-error path -- a stack trace on
			// stdout and exit `1`.
			platform: OkfitPlatform,
			// K-30. `CliRuntime.main` never renders a `ShowHelp` itself
			// (`Command.runWith` already rendered the help document). The
			// `exitCode: 3` fallback is the infrastructure tier for any typed error
			// that carries no code of its own.
			exitCode: 3,
			render: renderFailure,
			// A usage error's help goes to stderr beside the parse errors, so
			// stdout stays clean for the plugin hooks that parse it as JSON. An
			// explicit `--help` and a bare group invocation stay on stdout.
			helpOnUsageError: "stderr",
			// #217: builds `@effected/env`'s runtime and terminal services, the
			// audience (flag > `OKFIT_AUDIENCE` > detection), `CliTheme` and
			// `CliInteractive`, and gates the terminal and `--wizard` when the run
			// is not interactive -- inside failure reporting, like `platform`.
			//
			// `stderrIsTerminal` is stderr's own check (the kit otherwise mirrors
			// stdout's), so `okfit ... 2>err.log` never paints a redirected stderr.
			// The kit has no default for it, by design: core exposes no stderr
			// terminal check (Effect-TS/effect#8639) and a library never reads
			// `process`, so the bin, the one place that reads its host, passes it.
			// This is the kit's documented shape; it drops out when core ships one.
			// `formatter` keeps okfit's `--version` line; it must come through
			// `env` (not a layer inside the program) for `helpOnUsageError` to
			// see the formatter. Help and error rendering stay the kit's default.
			env: {
				audienceEnvVar: "OKFIT_AUDIENCE",
				stderrIsTerminal: Effect.sync(() => process.stderr.isTTY === true),
				formatter: versionFormatter(distribution),
			},
		}),
	);
};
