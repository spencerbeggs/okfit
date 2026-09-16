import { assert, describe, it } from "@effect/vitest";
import { CONFIG_SCHEMA_VERSION, OKF_SPEC_VERSION } from "@okfit/core";
import { ENGINE_VERSION } from "@okfit/engine";
import { versionFormatter } from "../../src/internal/versionFormatter.js";

describe("versionFormatter", () => {
	it("direct install: <name> <version> (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)", () => {
		const formatted = versionFormatter(undefined).formatVersion("okfit", "0.5.4");
		assert.strictEqual(
			formatted,
			`okfit 0.5.4 (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
		);
	});

	it("via a distribution: <name> <version> via <distName> <distVersion> (engine <ENGINE_VERSION>, okf <OKF_SPEC_VERSION>, config-schema <CONFIG_SCHEMA_VERSION>)", () => {
		const formatted = versionFormatter({ name: "@okfit/plugin", version: "0.3.7" }).formatVersion("okfit", "0.5.4");
		assert.strictEqual(
			formatted,
			`okfit 0.5.4 via @okfit/plugin 0.3.7 (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`,
		);
	});

	it("leaves formatHelpDoc/formatError/formatErrors/formatCliError as the default formatter's own", () => {
		const formatter = versionFormatter(undefined);
		assert.isFunction(formatter.formatHelpDoc);
		assert.isFunction(formatter.formatError);
		assert.isFunction(formatter.formatErrors);
		assert.isFunction(formatter.formatCliError);
	});
});
