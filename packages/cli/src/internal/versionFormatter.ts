import type { Distribution } from "@effected/engine";
import { distributionSuffix } from "@effected/engine";
import { CONFIG_SCHEMA_VERSION, OKF_SPEC_VERSION } from "@okfit/core";
import { ENGINE_VERSION } from "@okfit/engine";
import type { Option } from "effect";
import type { CliOutput } from "effect/cli";

/**
 * `okfit --version`'s full text (okfit #137):
 * `<name> <version>[ via <distName> <distVersion>] (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)`.
 * `GlobalFlag.Version`'s built-in `run` calls `formatter.formatVersion(command.name,
 * version)` (`command.name` is always `"okfit"`, `version` is `CLI_VERSION`), so
 * those two arguments alone are exactly `okfit <CLI_VERSION>`; this appends the
 * distribution, engine and okf parts.
 *
 * Passed to `CliRuntime.main` as `env.formatter`, the kit's one way to keep a
 * formatter method of our own: `main` installs its coloured default formatter
 * inside the platform, and `helpOnUsageError: "stderr"` only reroutes help
 * written through a formatter `main` installed. Every method left out keeps the
 * kit's coloured default, so help and error rendering stay consistent with the
 * run's colour decision.
 *
 * `distribution` is the value `main` was given (and provides as
 * `CurrentDistribution`); it is known before the program runs, so it is read
 * directly rather than from the context.
 *
 * @internal
 */
export const versionFormatter = (
	distribution: Option.Option<Distribution>,
): Pick<CliOutput.Formatter, "formatVersion"> => ({
	formatVersion: (name: string, version: string): string =>
		`${name} ${version}${distributionSuffix(distribution)} (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
});
