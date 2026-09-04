import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = resolve(import.meta.dirname, "..", "..", "dist", "dev", "pkg", "bin", "okfit-mcp.js");

describe("okfit-mcp bin", () => {
	it("reports not implemented on stderr and exits 1", () => {
		const result = spawnSync(process.execPath, [BIN], { encoding: "utf8" });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("not implemented");
		expect(result.stdout).toBe("");
	});
});
