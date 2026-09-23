import { describe, expect, it } from "vitest";
import { BUNDLED_NODE_FLOOR, resolveServer } from "../src/resolve-server.js";

const bundled = "/ext/dist/server.js";
const existsIn = (paths: ReadonlyArray<string>) => (p: string) => paths.includes(p);
// A host well above the floor -- used by every test that is not itself
// exercising the Node-version branch (I6) -- so those tests keep asserting
// the pre-existing setting/workspace/bundled resolution order unchanged.
const modernNode = "24.18.1";

describe("resolveServer", () => {
	it("prefers the setting when the path exists", () => {
		const { launch, notes } = resolveServer({
			settingPath: "/opt/okfit-lsp",
			folders: ["/w"],
			bundledModule: bundled,
			exists: existsIn(["/opt/okfit-lsp", "/w/node_modules/.bin/okfit-lsp"]),
			hostNode: modernNode,
		});
		expect(launch).toEqual({ kind: "command", command: "/opt/okfit-lsp", args: ["--stdio"], source: "setting" });
		expect(notes).toEqual([]);
	});

	it("falls through a missing setting path with one note", () => {
		const { launch, notes } = resolveServer({
			settingPath: "/nope",
			folders: ["/w"],
			bundledModule: bundled,
			exists: existsIn(["/w/node_modules/.bin/okfit-lsp"]),
			hostNode: modernNode,
		});
		expect(launch.source).toBe("workspace");
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("/nope");
	});

	it("uses the first workspace folder that has a local okfit-lsp, in window order", () => {
		const { launch } = resolveServer({
			settingPath: undefined,
			folders: ["/a", "/b"],
			bundledModule: bundled,
			exists: existsIn(["/b/node_modules/.bin/okfit-lsp"]),
			hostNode: modernNode,
		});
		expect(launch).toEqual({
			kind: "command",
			command: "/b/node_modules/.bin/okfit-lsp",
			args: ["--stdio"],
			source: "workspace",
		});
	});

	it("falls back to the bundled server when nothing else exists", () => {
		const { launch } = resolveServer({
			settingPath: undefined,
			folders: ["/a"],
			bundledModule: bundled,
			exists: () => false,
			hostNode: modernNode,
		});
		expect(launch).toEqual({ kind: "module", module: bundled, source: "bundled" });
	});

	it("treats a whitespace-only setting as unset", () => {
		const { launch, notes } = resolveServer({
			settingPath: "   ",
			folders: [],
			bundledModule: bundled,
			exists: () => false,
			hostNode: modernNode,
		});
		expect(launch.source).toBe("bundled");
		expect(notes).toEqual([]);
	});

	describe("bundled launch vs. the host Node version (I6)", () => {
		it("launches the bundled server in-process when the host Node satisfies the floor", () => {
			const { launch, notes } = resolveServer({
				settingPath: undefined,
				folders: [],
				bundledModule: bundled,
				exists: () => false,
				hostNode: "24.18.1",
			});
			expect(launch).toEqual({ kind: "module", module: bundled, source: "bundled" });
			expect(notes).toEqual([]);
		});

		it("falls back to a PATH node with a note when the host Node is older than the floor", () => {
			const { launch, notes } = resolveServer({
				settingPath: undefined,
				folders: [],
				bundledModule: bundled,
				exists: () => false,
				hostNode: "22.15.0",
			});
			expect(launch).toEqual({
				kind: "command",
				command: "node",
				args: [bundled, "--stdio"],
				source: "bundled-path-node",
			});
			expect(notes).toHaveLength(1);
			expect(notes[0]).toContain("22.15.0");
		});

		it("treats a host Node exactly at the floor as satisfying it", () => {
			const { launch, notes } = resolveServer({
				settingPath: undefined,
				folders: [],
				bundledModule: bundled,
				exists: () => false,
				hostNode: BUNDLED_NODE_FLOOR,
			});
			expect(launch).toEqual({ kind: "module", module: bundled, source: "bundled" });
			expect(notes).toEqual([]);
		});
	});
});
