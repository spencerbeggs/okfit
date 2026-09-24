import { assert, describe, it } from "@effect/vitest";
import { CurrentDistribution } from "@effected/engine";
import { CONFIG_SCHEMA_VERSION, OKF_SPEC_VERSION } from "@okfit/core";
import { ENGINE_VERSION } from "@okfit/engine";
import { Effect, Option, Stdio } from "effect";
import { CliOutput } from "effect/unstable/cli";
import { versionFormatterLayer } from "../../src/internal/versionFormatter.js";

const withFormatter = <A>(
	distribution: Option.Option<{ readonly name: string; readonly version: string }>,
	body: (formatter: CliOutput.Formatter) => A,
) =>
	Effect.gen(function* () {
		const formatter = yield* CliOutput.Formatter;
		return body(formatter);
	}).pipe(
		Effect.provide(versionFormatterLayer),
		Effect.provideService(CurrentDistribution, distribution),
		Effect.provide(Stdio.layerTest({})),
	);

describe("versionFormatterLayer", () => {
	it.effect(
		"direct install: <name> <version> (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)",
		() =>
			Effect.gen(function* () {
				const formatted = yield* withFormatter(Option.none(), (formatter) => formatter.formatVersion("okfit", "0.5.4"));
				assert.strictEqual(
					formatted,
					`okfit 0.5.4 (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
				);
			}),
	);

	it.effect(
		"via a distribution: <name> <version> via <distName> <distVersion> (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)",
		() =>
			Effect.gen(function* () {
				const formatted = yield* withFormatter(Option.some({ name: "@okfit/plugin", version: "0.3.7" }), (formatter) =>
					formatter.formatVersion("okfit", "0.5.4"),
				);
				assert.strictEqual(
					formatted,
					`okfit 0.5.4 via @okfit/plugin 0.3.7 (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
				);
			}),
	);

	it.effect("leaves formatHelpDoc/formatError/formatErrors/formatCliError as CliColor's own default formatter", () =>
		Effect.gen(function* () {
			const hasAll = yield* withFormatter(
				Option.none(),
				(formatter) =>
					typeof formatter.formatHelpDoc === "function" &&
					typeof formatter.formatError === "function" &&
					typeof formatter.formatErrors === "function" &&
					typeof formatter.formatCliError === "function",
			);
			assert.isTrue(hasAll);
		}),
	);
});
