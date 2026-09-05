import { Command } from "effect/unstable/cli";

/**
 * K-5. No handler: the framework's own default for a command with neither a
 * `handle` nor a matched subcommand is
 * `Effect.fail(new CliError.ShowHelp({ commandPath, errors: [] }))`
 * (`EFCLI/internal/command.ts:119-124`), and a `ShowHelp` with no errors
 * carries `[Runtime.errorExitCode] = 0` (`EFCLI/CliError.ts:622`). Bare
 * `okfit` therefore prints the root help and exits `0` with no code in this
 * package at all; an unknown flag carries `errors.length > 0` and is
 * remapped to `64` in `bin.ts` (K-30).
 *
 * This group ships no subcommands: `validate` and `init` do not exist yet.
 * Task D2 appends `.pipe(Command.withSubcommands([validateCommand]))` and
 * Task E2 widens it to `[validateCommand, initCommand]` (K-48) once
 * `commands/validate.ts` and `commands/init.ts` exist; the name and
 * description below are final.
 *
 * @public
 */
export const rootCommand = Command.make("okfit", {}).pipe(
	Command.withDescription("Open Knowledge Format (OKF) v0.2 tooling: validate and scaffold bundles."),
);
