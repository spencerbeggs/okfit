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

	it("registers the action commands under category OKF", () => {
		const commands = (manifest.contributes as { commands: Array<{ command: string; category?: string }> }).commands;
		for (const id of ["okfit.setStatus", "okfit.markVerified"]) {
			const entry = commands.find((c) => c.command === id);
			expect(entry).toBeDefined();
			expect(entry?.category).toBe("OKF");
		}
	});

	it("gates the action commands in the command palette on okfit.isConcept && okfit.hasActions", () => {
		const palette = (manifest.contributes as { menus: { commandPalette: Array<{ command: string; when?: string }> } })
			.menus.commandPalette;
		for (const id of ["okfit.setStatus", "okfit.markVerified"]) {
			const entry = palette.find((p) => p.command === id);
			expect(entry?.when).toBe("okfit.isConcept && okfit.hasActions");
		}
	});

	it("adds view/item/context entries for the action commands gated on okfit.hasActions", () => {
		const menus = (
			manifest.contributes as {
				menus: Record<string, Array<{ command: string; when?: string; group?: string }>>;
			}
		).menus;
		const contextMenu = menus["view/item/context"];
		expect(contextMenu).toBeDefined();
		const ids = new Set((contextMenu ?? []).map((e) => e.command));
		expect(ids.has("okfit.setStatus")).toBe(true);
		expect(ids.has("okfit.markVerified")).toBe(true);
		const groups = new Set((contextMenu ?? []).map((e) => e.group));
		expect(groups.has("inline")).toBe(true);
		expect(groups.has("okfit@1")).toBe(true);
		for (const entry of contextMenu ?? []) {
			expect(entry.when).toBe("viewItem == okfit.concept && okfit.hasActions");
		}
	});
});
