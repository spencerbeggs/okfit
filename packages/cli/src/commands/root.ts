import { Console } from "effect";
import { Command } from "effect/unstable/cli";

/**
 * The `okfit` root command. Subcommands are attached in later releases.
 *
 * @public
 */
export const rootCommand = Command.make("okfit", {}, () =>
	Console.log("okfit: no subcommands are available yet. Run `okfit --help`."),
);
