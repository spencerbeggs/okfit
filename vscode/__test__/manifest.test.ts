import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_GLOB } from "../src/config-glob.js";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;

describe("extension manifest", () => {
	it("carries the Marketplace-required fields", () => {
		expect(manifest.name).toBe("@okfit/vscode-extension");
		expect(manifest.publisher).toBe("okfit");
		expect(manifest.displayName).toBe("okfit");
		expect(typeof manifest.version).toBe("string");
		expect((manifest.engines as { vscode: string }).vscode).toBe("^1.100.0");
		expect(manifest.main).toBe("./dist/extension.js");
		expect(manifest.type).toBe("module");
		expect(manifest.private).toBe(true);
	});

	it("packages under the Marketplace name okfit", () => {
		const script = readFileSync(join(root, "lib", "package-vsix.ts"), "utf8");
		expect(script).toContain('name: "okfit"');
		expect((manifest.scripts as Record<string, string>).package).toContain("lib/package-vsix.ts");
	});

	it("activates on the same config-file glob the client watches", () => {
		expect(manifest.activationEvents).toEqual([`workspaceContains:${CONFIG_GLOB}`]);
	});

	it("ships a 256x256 PNG icon that exists", () => {
		expect(manifest.icon).toMatch(/\.png$/);
		const bytes = readFileSync(join(root, manifest.icon as string));
		expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
		expect(bytes.readUInt32BE(16)).toBe(256);
		expect(bytes.readUInt32BE(20)).toBe(256);
	});

	it("declares no runtime dependencies (both entries are bundled)", () => {
		expect(manifest.dependencies ?? {}).toEqual({});
	});
});
