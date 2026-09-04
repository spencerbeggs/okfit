import { describe, expect, it } from "vitest";
import { OKF_SPEC_VERSION } from "../src/index.js";

describe("@okfit/core", () => {
	it("targets OKF spec version 0.2", () => {
		expect(OKF_SPEC_VERSION).toBe("0.2");
	});
});
