import { CLI_VERSION } from "@okfit/cli";
import { describe, expect, it } from "vitest";
import cliPackageJson from "../../cli/package.json" with { type: "json" };
import { OKFIT_BINS } from "../src/index.js";

describe("@okfit/plugin", () => {
	it("names both bins it installs", () => {
		expect(OKFIT_BINS).toEqual(["okfit", "okfit-mcp"]);
	});

	it("resolves @okfit/cli through the workspace", () => {
		expect(CLI_VERSION).toBe(cliPackageJson.version);
	});
});
