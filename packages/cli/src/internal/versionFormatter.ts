import { CONFIG_SCHEMA_VERSION, OKF_SPEC_VERSION } from "@okfit/core";
import { ENGINE_VERSION } from "@okfit/engine";
import type { CliOutput } from "effect/cli";

/**
 * `okfit --version`'s own shape (okfit #137):
 * `<name> <version> (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)`.
 * `GlobalFlag.Version`'s built-in `run` calls `formatter.formatVersion(command.name,
 * version)` (`command.name` is always `"okfit"`, `version` is `CLI_VERSION`), so
 * those two arguments alone are exactly `okfit <CLI_VERSION>`; this appends the
 * engine and okf parts. A carrier's ` via <distName> <distVersion>` is not
 * this formatter's: `CliRuntime.main`'s `distribution` option appends it to
 * the end of whatever this returns.
 *
 * Passed to `CliRuntime.main` as `env.formatter`: `helpOnUsageError: "stderr"`
 * only reroutes help written through a formatter `main` installed, so a layer
 * inside the program would not do. Every method left out keeps the kit's
 * coloured default.
 *
 * @internal
 */
export const versionFormatter: Pick<CliOutput.Formatter, "formatVersion"> = {
	formatVersion: (name: string, version: string): string =>
		`${name} ${version} (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
};
