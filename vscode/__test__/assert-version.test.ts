import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "..", "lib", "assert-version.sh");
const manifestWith = (version: string): string => {
	const dir = mkdtempSync(join(tmpdir(), "okfit-vsix-"));
	const p = join(dir, "package.json");
	writeFileSync(p, JSON.stringify({ name: "@okfit/vscode-extension", version }));
	return p;
};
const run = (tag: string, manifest: string) => spawnSync("bash", [script, tag, manifest], { encoding: "utf8" });

describe("assert-version.sh", () => {
	it("passes when the tag and manifest agree", () => {
		expect(run("@okfit/vscode-extension@1.2.3", manifestWith("1.2.3")).status).toBe(0);
	});
	it("fails when they disagree", () => {
		const r = run("@okfit/vscode-extension@1.2.3", manifestWith("1.2.4"));
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("does not match");
	});
	it("fails on a tag for a different package", () => {
		expect(run("@okfit/lsp@1.2.3", manifestWith("1.2.3")).status).toBe(2);
	});
});
