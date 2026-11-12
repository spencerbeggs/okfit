import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = resolve(import.meta.dirname, "..", "..");

/**
 * The packages that run (the carrier, the three front ends and the engine
 * they share) own their kit closure: every `effect`, `@effect/*` and
 * `@effected/*` runtime dependency is written `catalog:effected:exact`, so it
 * publishes an exact version and a kit patch never reaches an installed okfit
 * without an okfit release (effected-renovate ledger 0011, the carrier-closure
 * rule). `@okfit/core` and `@okfit/profiles` are libraries the engine
 * imports; they keep carets and take the kit as peers, so they are not here.
 */
const TOOLS = ["plugin", "cli", "mcp", "lsp", "engine"] as const;

const isKit = (name: string): boolean => name === "effect" || /^@effect(ed)?\//.test(name);

interface Manifest {
	readonly name: string;
	readonly bin?: unknown;
	readonly dependencies?: Record<string, string>;
}

const read = (dir: string): Manifest => JSON.parse(readFileSync(join(PACKAGES, dir, "package.json"), "utf8"));

describe("tool packages pin their kit closure exactly", () => {
	it("every kit runtime dependency of a tool package is catalog:effected:exact, non-vacuously", () => {
		const entries = TOOLS.flatMap((dir) => {
			const manifest = read(dir);
			return Object.entries(manifest.dependencies ?? {})
				.filter(([name]) => isKit(name))
				.map(([name, range]) => `${manifest.name} ${name}: ${range}`);
		});
		// Non-vacuity: a manifest rename or an empty filter would otherwise pass by checking nothing.
		expect(entries.length).toBeGreaterThan(40);
		expect(entries.filter((entry) => !entry.endsWith(": catalog:effected:exact"))).toEqual([]);
	});

	it("every package that ships a bin is covered as a tool package", () => {
		const withBin = readdirSync(PACKAGES, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.filter((entry) => read(entry.name).bin !== undefined)
			.map((entry) => entry.name);
		expect(withBin.length).toBeGreaterThan(0);
		expect(withBin.filter((dir) => !(TOOLS as ReadonlyArray<string>).includes(dir))).toEqual([]);
	});
});
