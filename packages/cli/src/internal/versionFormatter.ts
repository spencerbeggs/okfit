import { CONFIG_SCHEMA_VERSION, OKF_SPEC_VERSION } from "@okfit/core";
import type { Distribution } from "@okfit/engine";
import { ENGINE_VERSION } from "@okfit/engine";
import { CliOutput } from "effect/unstable/cli";
import { useColor } from "./tty.js";

/**
 * `okfit --version`'s full text (okfit #137):
 * `<name> <version>[ via <distName> <distVersion>] (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)`.
 * `GlobalFlag.Version`'s built-in `run` calls `formatter.formatVersion(command.name,
 * version)` (`command.name` is always `"okfit"`, `version` is `CLI_VERSION` --
 * `unstable/cli/GlobalFlag.ts:180-186`), so those two arguments alone are
 * exactly `okfit <CLI_VERSION>`; this appends the engine, okf, and
 * distribution parts.
 *
 * Only `formatVersion` is overridden -- every other `Formatter` method
 * (help, error rendering) is `CliOutput.defaultFormatter`'s own, built with
 * the SAME colour decision (`internal/tty.ts#useColor`, "exactly the
 * framework's own colour rule") the rest of this package already uses, so
 * help/error output is byte-identical to the built-in formatter.
 *
 * @internal
 */
export const versionFormatter = (distribution: Distribution | undefined): CliOutput.Formatter => ({
	...CliOutput.defaultFormatter({ colors: useColor() }),
	formatVersion: (name: string, version: string): string => {
		const via = distribution === undefined ? "" : ` via ${distribution.name} ${distribution.version}`;
		return `${name} ${version}${via} (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`;
	},
});
