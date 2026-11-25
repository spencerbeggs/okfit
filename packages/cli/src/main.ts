/**
 * The assembled okfit CLI program.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { CliAudience, CliFormat, CliRuntime } from "@effected/cli-kit";
import type { Distribution } from "@effected/kit";
import { Now, OkfitPlatform } from "@okfit/engine";
import { DateTime, Effect, Option } from "effect";
import { CliError } from "effect/cli";
import { rootCommand } from "./commands/root.js";
import { renderFailure } from "./errors.js";
import { usageEnvelope, wantsJson } from "./internal/usageEnvelope.js";
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
 * Assembled with `@effected/cli-kit`'s `CliRuntime.main` (`effect-v4-cli`'s
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
	const program = Effect.gen(function* () {
		const now = yield* nowEffect;
		return yield* CliAudience.run(rootCommand, { version: CLI_VERSION }).pipe(Effect.provideService(Now, now));
	});

	// #485: a parse-time usage error (a `ShowHelp` carrying `errors`) is raised by
	// the argument parser before any handler runs, so no command prints its JSON
	// error envelope. When the raw arguments ask for JSON, print one here, then
	// re-fail unchanged: the kit still prints help on stderr and exits 64. A bare
	// `--help` (`errors` empty) prints nothing extra.
	const argv = process.argv.slice(2);
	const withUsageEnvelope = wantsJson(argv)
		? program.pipe(
				Effect.tapError((error) =>
					CliError.isCliError(error) && error._tag === "ShowHelp" && error.errors.length > 0
						? CliFormat.printJson(usageEnvelope(error.errors, CLI_VERSION, options.distribution), { indent: 0 })
						: Effect.void,
				),
			)
		: program;

	NodeRuntime.runMain(
		CliRuntime.main(withUsageEnvelope, {
			// Provided INSIDE failure reporting, so a failure while building
			// `OkfitPlatform` (an `XdgEnvError` from an unset `HOME`, K-13) is
			// itself rendered and mapped to `exitCode: 3`, rather than escaping to
			// `NodeRuntime.runMain`'s own fatal-error path -- a stack trace on
			// stdout and exit `1`.
			platform: OkfitPlatform,
			// The carrier the bin was installed through (null for a direct
			// install): `main` provides it as `CurrentDistribution` around the
			// program, for every command and the engine, and appends its
			// ` via <name> <version>` to the end of `--version`.
			distribution: options.distribution ?? null,
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
			// Stderr's colour follows core's own `Stdio.stderrIsTerminal` (Effect
			// 4.1), so `okfit ... 2>err.log` never paints a redirected stderr with
			// nothing passed here.
			// `formatter` keeps okfit's `--version` line; it must come through
			// `env` (not a layer inside the program) for `helpOnUsageError` to
			// see the formatter. Help and error rendering stay the kit's default.
			env: {
				audienceEnvVar: "OKFIT_AUDIENCE",
				formatter: versionFormatter,
			},
		}),
	);
};
