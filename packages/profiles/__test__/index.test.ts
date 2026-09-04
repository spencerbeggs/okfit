import { OKF_SPEC_VERSION } from "@okfit/core";
import { describe, expect, it } from "vitest";
import { PROFILE_NAMES } from "../src/index.js";

describe("@okfit/profiles", () => {
	it("ships the software-project profile", () => {
		expect(PROFILE_NAMES).toEqual(["software-project"]);
	});

	it("resolves @okfit/core through the workspace", () => {
		expect(OKF_SPEC_VERSION).toBe("0.2");
	});
});
