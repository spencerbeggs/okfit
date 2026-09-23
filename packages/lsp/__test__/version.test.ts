import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { LSP_VERSION } from "../src/version.js";

describe("LSP_VERSION", () => {
	it("is semver-shaped and, unbuilt, is the 0.0.0 fallback", () => {
		assert.match(LSP_VERSION, /^\d+\.\d+\.\d+/);
		const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8")) as {
			readonly version: string;
		};
		assert.ok(LSP_VERSION === "0.0.0" || LSP_VERSION === pkg.version);
	});
});
