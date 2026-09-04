import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = resolve(import.meta.dirname, "..", "..", "dist", "dev", "pkg", "bin", "okfit.js");

describe("okfit bin", () => {
	it("prints its version", () => {
		const stdout = execFileSync(process.execPath, [BIN, "--version"], { encoding: "utf8" });
		expect(stdout.trim()).toBe("okfit v0.0.0");
	});

	it("prints help without a subcommand", () => {
		const stdout = execFileSync(process.execPath, [BIN, "--help"], { encoding: "utf8" });
		expect(stdout).toContain("okfit");
	});
});
