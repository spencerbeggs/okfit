import { CliColor } from "@effected/cli";
import { CurrentDistribution, distributionSuffix } from "@effected/engine";
import { CONFIG_SCHEMA_VERSION, OKF_SPEC_VERSION } from "@okfit/core";
import { ENGINE_VERSION } from "@okfit/engine";
import { Effect, Layer } from "effect";

/**
 * `okfit --version`'s full text (okfit #137):
 * `<name> <version>[ via <distName> <distVersion>] (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)`.
 * `GlobalFlag.Version`'s built-in `run` calls `formatter.formatVersion(command.name,
 * version)` (`command.name` is always `"okfit"`, `version` is `CLI_VERSION` --
 * `unstable/cli/GlobalFlag.ts:180-186`), so those two arguments alone are
 * exactly `okfit <CLI_VERSION>`; this appends the engine, okf, and
 * distribution parts.
 *
 * Built on `@effected/cli`'s `CliColor.formatterLayer` (the kit's one
 * colour-decision point, read through the ambient `ConfigProvider`, never
 * `process` directly) and `@effected/engine`'s `distributionSuffix` for the
 * `via <name> <version>` segment -- the shape `effect-v4-cli`'s
 * `recipes.md#version-formatter` teaches. Only `formatVersion` is
 * overridden; every other `Formatter` method (help, error rendering) is
 * `CliColor.formatterLayer`'s own default, so help/error output stays
 * consistent with the rest of the program's colour decision.
 *
 * `Layer.unwrap` around `Effect.map(CurrentDistribution, ...)` reads the
 * distribution once, from the ambient `CurrentDistribution` reference
 * `main.ts` provides, rather than threading it in as a constructor argument
 * the way the hand-rolled formatter used to.
 *
 * @internal
 */
export const versionFormatterLayer = Layer.unwrap(
	Effect.map(CurrentDistribution, (distribution) =>
		CliColor.formatterLayer({
			formatVersion: (name: string, version: string): string =>
				`${name} ${version}${distributionSuffix(distribution)} (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
		}),
	),
);
