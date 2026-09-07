import { Command } from "effect/unstable/cli";
import { contextCommand } from "./context.js";
import { initCommand } from "./init.js";
import { validateCommand } from "./validate.js";
import { verifyCommand } from "./verify.js";

/**
 * K-5. No handler: the framework's own default for a command with neither a
 * `handle` nor a matched subcommand is
 * `Effect.fail(new CliError.ShowHelp({ commandPath, errors: [] }))`, and a
 * `ShowHelp` with no errors carries `[Runtime.errorExitCode] = 0`. Bare
 * `okfit` therefore prints the root help and exits `0` with no code in this
 * package at all.
 *
 * `validate`, `init`, `context`, and `verify` are the whole command tree;
 * nothing else is registered here. `context` is appended last, not
 * reordered in, so `--help`'s subcommand list reads in introduction order
 * (contract §8.6). The top-level description is left unchanged: `context`
 * neither validates nor scaffolds, but widening the sentence for a third
 * orientation-only command buys nothing (contract §8.6).
 *
 * @public
 */
export const rootCommand = Command.make("okfit", {}).pipe(
	Command.withDescription("Open Knowledge Format (OKF) v0.2 tooling: validate and scaffold bundles."),
	Command.withSubcommands([validateCommand, initCommand, contextCommand, verifyCommand]),
);
