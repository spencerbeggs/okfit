import { Command } from "effect/unstable/cli";
import { contextCommand } from "./context.js";
import { graphCommand } from "./graph.js";
import { initCommand } from "./init.js";
import { lintCommand } from "./lint.js";
import { staleCommand } from "./stale.js";
import { syncCommand } from "./sync.js";
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
 * `validate`, `init`, `context`, `verify`, `sync`, `lint`, `graph`, and
 * `stale` are the whole command tree; nothing else is registered here.
 * Each is appended in introduction order, never reordered in, so
 * `--help`'s subcommand list reads that way too (contract §4.2). The
 * top-level description is left unchanged: neither `context` nor `verify`
 * validates or scaffolds, but widening the sentence for the orientation-
 * and attestation-only commands buys nothing (contract §4.2).
 *
 * @public
 */
export const rootCommand = Command.make("okfit", {}).pipe(
	Command.withDescription("Open Knowledge Format (OKF) v0.2 tooling: validate and scaffold bundles."),
	Command.withSubcommands([
		validateCommand,
		initCommand,
		contextCommand,
		verifyCommand,
		syncCommand,
		lintCommand,
		graphCommand,
		staleCommand,
	]),
);
