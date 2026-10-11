import { Flag } from "effect/cli";

/**
 * `--root <dir>`: the PROJECT root config discovery starts from (default:
 * the current directory); never the bundle root (K-2). It replaced the
 * `[path]` positional so positionals mean concept targets everywhere. Not
 * `mustExist`: the handler stats it through `provideConfig` (K-1). Absolute
 * at parse time (K-50).
 *
 * @public
 */
export const rootFlag = Flag.Directory("root").pipe(
	Flag.optional,
	Flag.withDescription(
		"project root to start config discovery from (default: current directory); never the bundle root",
	),
);
