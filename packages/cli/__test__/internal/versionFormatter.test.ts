import { assert, describe, it } from "@effect/vitest";
import { CONFIG_SCHEMA_VERSION, OKF_SPEC_VERSION } from "@okfit/core";
import { ENGINE_VERSION } from "@okfit/engine";
import { Option } from "effect";
import { versionFormatter } from "../../src/internal/versionFormatter.js";

describe("versionFormatter", () => {
	it("direct install: <name> <version> (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)", () => {
		assert.strictEqual(
			versionFormatter(Option.none()).formatVersion("okfit", "0.5.4"),
			`okfit 0.5.4 (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
		);
	});

	it("via a distribution: <name> <version> via <distName> <distVersion> (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)", () => {
		assert.strictEqual(
			versionFormatter(Option.some({ name: "@okfit/plugin", version: "0.3.7" })).formatVersion("okfit", "0.5.4"),
			`okfit 0.5.4 via @okfit/plugin 0.3.7 (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
		);
	});

	it("overrides only formatVersion, so help and error rendering stay the kit's default formatter", () => {
		assert.deepStrictEqual(Object.keys(versionFormatter(Option.none())), ["formatVersion"]);
	});
});
