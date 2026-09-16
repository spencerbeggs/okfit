import type { Distribution as DistributionShape } from "@okfit/engine";
import { Context, Option } from "effect";

/**
 * The meta-package this run's bins were installed through (currently only
 * `@okfit/plugin`), threaded from `main(options)` down to every command
 * that builds a JSON envelope or the custom `--version` formatter (okfit
 * #137). Defaults to `Option.none()` for a direct install of `@okfit/cli`;
 * `main()` provides `Option.some(options.distribution)` exactly once, at
 * the top of the command tree, when the caller supplied one.
 *
 * A `Context.Reference`, not a `Context.Service` (unlike `Now`): it carries
 * its own default, so a command can read it with no explicit provision at
 * all when no distribution was given.
 *
 * @internal
 */
export const Distribution: Context.Reference<Option.Option<DistributionShape>> = Context.Reference(
	"@okfit/cli/Distribution",
	{ defaultValue: () => Option.none() },
);
