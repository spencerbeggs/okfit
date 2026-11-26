/**
 * The `--format` global setting (okfit #485).
 *
 * `--format human|json` is a `GlobalFlag.Setting` attached with
 * `Command.withGlobalFlags` to exactly the commands that have it, so
 * `CliRuntime.main`'s `renderUsageError` can ask `setting(Format)` whether a
 * usage error was raised for an invocation that really asked for JSON. A
 * command without the flag (`init`, the bare `query` browser) does not declare
 * it, so `--format json` there is an ordinary usage error with no envelope.
 *
 * `graph` is deliberately not on it: its `--format` takes `mermaid|dot|json`
 * with a different default, and effect 4.1.6's flag registry rejects two
 * global settings that share a flag name (`Duplicate flag name "format"`).
 * `graph` keeps a local flag and `main.ts` checks its argv narrowly.
 *
 * @packageDocumentation
 */

import { CliFormat } from "@effected/cli-kit";
import { Effect } from "effect";
import { GlobalFlag } from "effect/cli";

/**
 * `--format human|json` (default `human`; `human` is an alias of `auto`).
 *
 * @internal
 */
export const Format = GlobalFlag.Setting("format")({
	flag: CliFormat.flag<"json", { readonly human: "auto" }>(["json"], {
		aliases: { human: "auto" },
		default: "human",
		description: "output format: human (default) or json",
	}),
});

/**
 * Hand a handler its `format` beside the parsed `input`, read from {@link Format}.
 *
 * @internal
 */
export const withFormat =
	<I, A, E, R>(handler: (input: I & { readonly format: typeof Format.Service }) => Effect.Effect<A, E, R>) =>
	(input: I) =>
		Effect.flatMap(Format, (format) => handler({ ...input, format }));
