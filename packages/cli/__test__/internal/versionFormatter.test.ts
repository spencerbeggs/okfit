import { assert, describe, it } from "@effect/vitest";
import { withDistributionVersion } from "@effected/engine";
import { CONFIG_SCHEMA_VERSION, OKF_SPEC_VERSION } from "@okfit/core";
import { ENGINE_VERSION } from "@okfit/engine";
import { Option } from "effect";
import { versionFormatter } from "../../src/internal/versionFormatter.js";

describe("versionFormatter", () => {
	it("direct install: <name> <version> (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)", () => {
		assert.strictEqual(
			versionFormatter.formatVersion("okfit", "0.5.4"),
			`okfit 0.5.4 (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
		);
	});

	it("via a distribution, the kit appends the carrier at the end: <...> (engine ..., okf ..., config-schema ...) via <distName> <distVersion>", () => {
		// `CliRuntime.main`'s `distribution` option composes the formatter this way.
		const formatVersion = withDistributionVersion(Option.some({ name: "@okfit/plugin", version: "0.3.7" }))(
			versionFormatter.formatVersion,
		);
		assert.strictEqual(
			formatVersion("okfit", "0.5.4"),
			`okfit 0.5.4 (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION}) via @okfit/plugin 0.3.7`,
		);
	});

	it("overrides only formatVersion, so help and error rendering stay the kit's default formatter", () => {
		assert.deepStrictEqual(Object.keys(versionFormatter), ["formatVersion"]);
	});
});
