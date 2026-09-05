import { assert, describe, it } from "@effect/vitest";
import packageJson from "../package.json" with { type: "json" };
import { CLI_VERSION } from "../src/version.js";

describe("CLI_VERSION", () => {
	it("matches the package's own package.json version, never a literal (K-32)", () => {
		assert.strictEqual(CLI_VERSION, packageJson.version);
	});
});
