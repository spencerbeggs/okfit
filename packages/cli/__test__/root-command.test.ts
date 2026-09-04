import { describe, expect, it } from "vitest";
import { CLI_VERSION, rootCommand } from "../src/index.js";

describe("rootCommand", () => {
	it("is named okfit", () => {
		expect(rootCommand.name).toBe("okfit");
	});

	it("reports version 0.0.0 while unpublished", () => {
		expect(CLI_VERSION).toBe("0.0.0");
	});
});
