import { assert, describe, it } from "@effect/vitest";
import { OKF_SPEC_VERSION } from "@okfit/core";
import { PROFILE_NAMES } from "../src/index.js";

describe("@okfit/profiles", () => {
	it("ships the software-project profile", () => {
		assert.deepStrictEqual([...PROFILE_NAMES], ["software-project"]);
	});

	it("resolves @okfit/core through the workspace", () => {
		assert.strictEqual(OKF_SPEC_VERSION, "0.2");
	});
});
