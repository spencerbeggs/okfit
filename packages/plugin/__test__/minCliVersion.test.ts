import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = resolve(import.meta.dirname, "..", "..");

// plugin/ sits outside this package's tsconfig rootDir, so read the constant as text.
const MIN_CLI_VERSION =
	/MIN_CLI_VERSION = "([^"]+)"/.exec(readFileSync(join(PACKAGES, "..", "plugin", "min-cli.ts"), "utf8"))?.[1] ?? "";

const triple = (version: string): ReadonlyArray<number> => {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (match === null) throw new Error(`not a version: ${version}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const lte = (a: string, b: string): boolean => {
	const [x, y] = [triple(a), triple(b)];
	for (let i = 0; i < 3; i++) {
		if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
	}
	return true;
};

describe("the plugin's minimum CLI version (okfit #221)", () => {
	const cli = JSON.parse(readFileSync(join(PACKAGES, "cli", "package.json"), "utf8")) as { version: string };

	it("is a plain major.minor.patch version", () => {
		expect(MIN_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("never exceeds the workspace @okfit/cli version", () => {
		expect(lte(MIN_CLI_VERSION, cli.version)).toBe(true);
	});

	it("the comparison helper rejects a floor above the CLI, so the check can fail", () => {
		expect(lte("0.17.0", "0.16.7")).toBe(false);
		expect(lte("0.16.7", "0.16.7")).toBe(true);
	});
});
