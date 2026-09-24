/**
 * The assembled okfit CLI program.
 *
 * @packageDocumentation
 */

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { CliRuntime } from "@effected/cli";
import type { Distribution } from "@effected/engine";
import { CurrentDistribution } from "@effected/engine";
import { Now, OkfitPlatform } from "@okfit/engine";
import { DateTime, Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";
import { rootCommand } from "./commands/root.js";
import { renderFailure } from "./errors.js";
import { versionFormatterLayer } from "./internal/versionFormatter.js";
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
		return yield* Command.run(rootCommand, { version: CLI_VERSION }).pipe(Effect.provideService(Now, now));
	}).pipe(
		// Only `formatVersion` differs from `CliColor`'s own default
		// formatter; help/error rendering stay whatever `CliColor` decides
		// (`internal/versionFormatter.ts`).
		Effect.provide(versionFormatterLayer),
		// Outermost so `versionFormatterLayer`'s own read of `CurrentDistribution`
		// (built via `Effect.provide` above, which builds its layer against the
		// ambient context supplied from here) sees the distribution this run was
		// given, not the reference's own `Option.none()` default.
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
			// K-30. `renderFailure` returns `[]` for a `ShowHelp`, because
			// `CliRuntime.main` never renders one itself (`Command.runWith`
			// already rendered the help document). The `exitCode: 3` fallback is
			// the infrastructure tier for any typed error that carries no code of
			// its own.
			exitCode: 3,
			render: renderFailure,
		}),
	);
};
