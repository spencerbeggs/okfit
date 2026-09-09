import { assert, describe, it } from "@effect/vitest";
import { CLI_VERSION } from "../src/version.js";

describe("CLI_VERSION", () => {
	it("is a semver-shaped string; in unbuilt source it is the '0.0.0' fallback (K-32)", () => {
		assert.match(CLI_VERSION, /^\d+\.\d+\.\d+/);
	});
});
