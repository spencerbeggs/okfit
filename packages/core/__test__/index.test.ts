import { assert, describe, it } from "@effect/vitest";
import { OKF_SPEC_VERSION } from "../src/index.js";

describe("@okfit/core", () => {
	it("targets OKF spec version 0.2", () => {
		assert.strictEqual(OKF_SPEC_VERSION, "0.2");
	});
});
