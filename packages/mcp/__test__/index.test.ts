import { describe, expect, it } from "vitest";
import { NOT_IMPLEMENTED_EXIT_CODE, NOT_IMPLEMENTED_MESSAGE } from "../src/index.js";

describe("@okfit/mcp", () => {
	it("exposes the not-implemented contract", () => {
		expect(NOT_IMPLEMENTED_EXIT_CODE).toBe(1);
		expect(NOT_IMPLEMENTED_MESSAGE).toContain("not implemented");
	});
});
