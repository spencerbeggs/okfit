import { Command } from "effect/unstable/cli";
import { validateCommand } from "./validate.js";

/**
 * K-5. No handler: the framework's own default for a command with neither a
 * `handle` nor a matched subcommand is
 * `Effect.fail(new CliError.ShowHelp({ commandPath, errors: [] }))`, and a
 * `ShowHelp` with no errors carries `[Runtime.errorExitCode] = 0`. Bare
 * `okfit` therefore prints the root help and exits `0` with no code in this
 * package at all.
 *
 * `initCommand` joins `withSubcommands` in Group E's Task E2; only
 * `validate` is registered here (this group's scope).
 *
 * @public
 */
export const rootCommand = Command.make("okfit", {}).pipe(
	Command.withDescription("Open Knowledge Format (OKF) v0.2 tooling: validate and scaffold bundles."),
	Command.withSubcommands([validateCommand]),
);
