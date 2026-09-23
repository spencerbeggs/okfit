import { CLI_VERSION } from "@okfit/cli";
import { describe, expect, it } from "vitest";
import cliPackageJson from "../../cli/package.json" with { type: "json" };
import { OKFIT_BINS, PLUGIN_VERSION } from "../src/index.js";

describe("@okfit/plugin", () => {
	it("names all three bins it installs", () => {
		expect(OKFIT_BINS).toEqual(["okfit", "okfit-mcp", "okfit-lsp"]);
	});

	it("resolves @okfit/cli through the workspace", () => {
		expect(CLI_VERSION).toBe(cliPackageJson.version);
	});

	// Unbuilt source: process.env.__PACKAGE_VERSION__ is a build-time
	// constant (K-32) that only exists once @savvy-web/bundler replaces it;
	// PLUGIN_VERSION reads "0.0.0" here, same as CLI_VERSION/MCP_VERSION's
	// own unit tests. The real substituted value is what
	// e2e/bins.e2e.test.ts's `--version` regex asserts against the built bin.
	it("exports PLUGIN_VERSION, a semver-shaped string (K-32 fallback in unbuilt source)", () => {
		expect(PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+/);
	});
});
