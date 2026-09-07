import { assert, describe, it } from "@effect/vitest";
import { resolveMcpProjectRoot } from "../src/internal/projectRoot.js";

describe("resolveMcpProjectRoot", () => {
	it("prefers OKFIT_PROJECT_DIR over CLAUDE_PROJECT_DIR and cwd", () => {
		assert.strictEqual(resolveMcpProjectRoot({ OKFIT_PROJECT_DIR: "/a", CLAUDE_PROJECT_DIR: "/b" }), "/a");
	});

	it("falls back to CLAUDE_PROJECT_DIR when OKFIT_PROJECT_DIR is unset", () => {
		assert.strictEqual(resolveMcpProjectRoot({ CLAUDE_PROJECT_DIR: "/b" }), "/b");
	});

	it("falls back to cwd when neither is set", () => {
		assert.strictEqual(resolveMcpProjectRoot({}), process.cwd());
	});
});
