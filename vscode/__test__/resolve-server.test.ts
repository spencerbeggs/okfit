import { describe, expect, it } from "vitest";
import { BUNDLED_NODE_FLOOR, resolveServer } from "../src/resolve-server.js";

const bundled = "/ext/dist/server.js";
const existsIn = (paths: ReadonlyArray<string>) => (p: string) => paths.includes(p);
const identityRealPath = (p: string) => p;
// A host well above the floor -- used by every test that is not itself
// exercising the Node-version branch (I6) -- so those tests keep asserting
// the pre-existing setting/workspace/bundled resolution order unchanged.
const modernNode = "24.18.1";

describe("resolveServer", () => {
	it("prefers the setting when the path exists", () => {
		const { candidates, notes } = resolveServer({
			folders: [{ path: "/w", settingPath: "/opt/okfit-lsp" }],
			bundledModule: bundled,
			exists: existsIn(["/opt/okfit-lsp", "/w/node_modules/.bin/okfit-lsp"]),
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates[0]).toEqual({ kind: "command", command: "/opt/okfit-lsp", args: ["--stdio"], source: "setting" });
		expect(notes).toEqual([]);
	});

	it("falls through a missing setting path with one note", () => {
		const { candidates, notes } = resolveServer({
			folders: [{ path: "/w", settingPath: "/nope" }],
			bundledModule: bundled,
			exists: existsIn(["/w/node_modules/.bin/okfit-lsp"]),
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates[0]?.source).toBe("workspace");
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("/nope");
	});

	it("uses every workspace folder that has a local okfit-lsp, in window order, before the bundled server", () => {
		const { candidates } = resolveServer({
			folders: [
				{ path: "/a", settingPath: undefined },
				{ path: "/b", settingPath: undefined },
			],
			bundledModule: bundled,
			exists: existsIn(["/b/node_modules/.bin/okfit-lsp"]),
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates).toEqual([
			{ kind: "command", command: "/b/node_modules/.bin/okfit-lsp", args: ["--stdio"], source: "workspace" },
			{ kind: "module", module: bundled, source: "bundled" },
		]);
	});

	it("lists both folders' local servers in window order, then the bundled server", () => {
		const { candidates } = resolveServer({
			folders: [
				{ path: "/a", settingPath: undefined },
				{ path: "/b", settingPath: undefined },
			],
			bundledModule: bundled,
			exists: existsIn(["/a/node_modules/.bin/okfit-lsp", "/b/node_modules/.bin/okfit-lsp"]),
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates).toEqual([
			{ kind: "command", command: "/a/node_modules/.bin/okfit-lsp", args: ["--stdio"], source: "workspace" },
			{ kind: "command", command: "/b/node_modules/.bin/okfit-lsp", args: ["--stdio"], source: "workspace" },
			{ kind: "module", module: bundled, source: "bundled" },
		]);
	});

	it("outranks a first folder's local server with a second folder's setting", () => {
		const { candidates } = resolveServer({
			folders: [
				{ path: "/a", settingPath: undefined },
				{ path: "/b", settingPath: "/opt/okfit-lsp" },
			],
			bundledModule: bundled,
			exists: existsIn(["/a/node_modules/.bin/okfit-lsp", "/opt/okfit-lsp"]),
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates[0]).toEqual({ kind: "command", command: "/opt/okfit-lsp", args: ["--stdio"], source: "setting" });
		expect(candidates[1]).toEqual({
			kind: "command",
			command: "/a/node_modules/.bin/okfit-lsp",
			args: ["--stdio"],
			source: "workspace",
		});
	});

	it("adds a note for a missing setting path on one folder without blocking another folder's setting", () => {
		const { candidates, notes } = resolveServer({
			folders: [
				{ path: "/a", settingPath: "/nope" },
				{ path: "/b", settingPath: "/opt/okfit-lsp" },
			],
			bundledModule: bundled,
			exists: existsIn(["/opt/okfit-lsp"]),
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates[0]).toEqual({ kind: "command", command: "/opt/okfit-lsp", args: ["--stdio"], source: "setting" });
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("/nope");
	});

	it("dedupes two folders' local servers that resolve to the same real path", () => {
		const { candidates } = resolveServer({
			folders: [
				{ path: "/a", settingPath: undefined },
				{ path: "/link-to-a", settingPath: undefined },
			],
			bundledModule: bundled,
			exists: existsIn(["/a/node_modules/.bin/okfit-lsp", "/link-to-a/node_modules/.bin/okfit-lsp"]),
			realPath: (p) => (p === "/link-to-a/node_modules/.bin/okfit-lsp" ? "/a/node_modules/.bin/okfit-lsp" : p),
			hostNode: modernNode,
		});
		expect(candidates).toEqual([
			{ kind: "command", command: "/a/node_modules/.bin/okfit-lsp", args: ["--stdio"], source: "workspace" },
			{ kind: "module", module: bundled, source: "bundled" },
		]);
	});

	it("falls back to the bundled server when nothing else exists", () => {
		const { candidates } = resolveServer({
			folders: [{ path: "/a", settingPath: undefined }],
			bundledModule: bundled,
			exists: () => false,
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates).toEqual([{ kind: "module", module: bundled, source: "bundled" }]);
	});

	it("treats a whitespace-only setting as unset", () => {
		const { candidates, notes } = resolveServer({
			folders: [{ path: "/a", settingPath: "   " }],
			bundledModule: bundled,
			exists: () => false,
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates).toEqual([{ kind: "module", module: bundled, source: "bundled" }]);
		expect(notes).toEqual([]);
	});

	it("never returns an empty candidate list", () => {
		const { candidates } = resolveServer({
			folders: [],
			bundledModule: bundled,
			exists: () => false,
			realPath: identityRealPath,
			hostNode: modernNode,
		});
		expect(candidates.length).toBeGreaterThan(0);
	});

	describe("bundled launch vs. the host Node version (I6)", () => {
		it("launches the bundled server in-process when the host Node satisfies the floor", () => {
			const { candidates, notes } = resolveServer({
				folders: [],
				bundledModule: bundled,
				exists: () => false,
				realPath: identityRealPath,
				hostNode: "24.18.1",
			});
			expect(candidates).toEqual([{ kind: "module", module: bundled, source: "bundled" }]);
			expect(notes).toEqual([]);
		});

		it("falls back to a PATH node with a note when the host Node is older than the floor", () => {
			const { candidates, notes } = resolveServer({
				folders: [],
				bundledModule: bundled,
				exists: () => false,
				realPath: identityRealPath,
				hostNode: "22.15.0",
			});
			expect(candidates).toEqual([
				{
					kind: "command",
					command: "node",
					args: [bundled, "--stdio"],
					source: "bundled-path-node",
				},
			]);
			expect(notes).toHaveLength(1);
			expect(notes[0]).toContain("22.15.0");
		});

		it("treats a host Node exactly at the floor as satisfying it", () => {
			const { candidates, notes } = resolveServer({
				folders: [],
				bundledModule: bundled,
				exists: () => false,
				realPath: identityRealPath,
				hostNode: BUNDLED_NODE_FLOOR,
			});
			expect(candidates).toEqual([{ kind: "module", module: bundled, source: "bundled" }]);
			expect(notes).toEqual([]);
		});
	});
});
