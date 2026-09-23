import { describe, expect, it } from "vitest";
import { resolveServer } from "../src/resolve-server.js";

const bundled = "/ext/dist/server.js";
const existsIn = (paths: ReadonlyArray<string>) => (p: string) => paths.includes(p);

describe("resolveServer", () => {
	it("prefers the setting when the path exists", () => {
		const { launch, notes } = resolveServer({
			settingPath: "/opt/okfit-lsp",
			folders: ["/w"],
			bundledModule: bundled,
			exists: existsIn(["/opt/okfit-lsp", "/w/node_modules/.bin/okfit-lsp"]),
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
		});
		expect(launch).toEqual({ kind: "module", module: bundled, source: "bundled" });
	});

	it("treats a whitespace-only setting as unset", () => {
		const { launch, notes } = resolveServer({
			settingPath: "   ",
			folders: [],
			bundledModule: bundled,
			exists: () => false,
		});
		expect(launch.source).toBe("bundled");
		expect(notes).toEqual([]);
	});
});
