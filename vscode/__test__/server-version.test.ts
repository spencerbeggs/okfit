import { describe, expect, it } from "vitest";
import type { ServerVersionDeps } from "../src/server-version.js";
import { readWorkspaceServerVersion } from "../src/server-version.js";

/** An in-memory `ServerVersionDeps`: `files` maps an exact path to its content; `realpaths` maps an exact path to its resolved target, falling back to identity (mirroring `client.ts`'s real `realPath`). */
const deps = (
	files: Readonly<Record<string, string>>,
	realpaths: Readonly<Record<string, string>> = {},
): ServerVersionDeps => ({
	readFile: (path) => files[path],
	realpath: (path) => realpaths[path] ?? path,
});

const pkg = (name: string, version: string): string => JSON.stringify({ name, version });

describe("readWorkspaceServerVersion", () => {
	it("reads the direct node_modules/@okfit/lsp/package.json", () => {
		const result = readWorkspaceServerVersion(
			deps({ "/w/node_modules/@okfit/lsp/package.json": pkg("@okfit/lsp", "0.3.0") }),
			"/w",
		);
		expect(result).toBe("0.3.0");
	});

	it("follows the bin's realpath to @okfit/plugin's own nested @okfit/lsp dependency", () => {
		const result = readWorkspaceServerVersion(
			deps(
				{
					"/w/node_modules/@okfit/plugin/package.json": pkg("@okfit/plugin", "1.0.0"),
					"/w/node_modules/@okfit/plugin/node_modules/@okfit/lsp/package.json": pkg("@okfit/lsp", "0.4.0"),
				},
				{ "/w/node_modules/.bin/okfit-lsp": "/w/node_modules/@okfit/plugin/dist/cli.js" },
			),
			"/w",
		);
		expect(result).toBe("0.4.0");
	});

	it("follows the bin's realpath into a pnpm .pnpm store entry and reads @okfit/lsp as a sibling of @okfit/plugin", () => {
		const pluginDir = "/w/node_modules/.pnpm/@okfit+plugin@1.0.0/node_modules/@okfit/plugin";
		const result = readWorkspaceServerVersion(
			deps(
				{
					[`${pluginDir}/package.json`]: pkg("@okfit/plugin", "1.0.0"),
					"/w/node_modules/.pnpm/@okfit+plugin@1.0.0/node_modules/@okfit/lsp/package.json": pkg("@okfit/lsp", "0.5.0"),
				},
				{ "/w/node_modules/.bin/okfit-lsp": `${pluginDir}/dist/cli.js` },
			),
			"/w",
		);
		expect(result).toBe("0.5.0");
	});

	it("answers undefined when the bin's realpath resolves outside any package (unknown)", () => {
		const result = readWorkspaceServerVersion(
			deps({}, { "/w/node_modules/.bin/okfit-lsp": "/somewhere/unrelated/cli.js" }),
			"/w",
		);
		expect(result).toBeUndefined();
	});

	it("stops at a package.json that exists but does not parse, rather than walking further up (unknown)", () => {
		// A valid @okfit/lsp package.json one level further up would answer "9.9.9" if the malformed
		// package.json below it were (wrongly) treated the same as a missing file and skipped.
		const result = readWorkspaceServerVersion(
			deps(
				{
					"/w/node_modules/@okfit/plugin/package.json": "{not valid json",
					"/w/node_modules/@okfit/package.json": pkg("@okfit/lsp", "9.9.9"),
				},
				{ "/w/node_modules/.bin/okfit-lsp": "/w/node_modules/@okfit/plugin/dist/cli.js" },
			),
			"/w",
		);
		expect(result).toBeUndefined();
	});

	it("answers undefined when neither the direct package.json nor the bin resolve to anything", () => {
		const result = readWorkspaceServerVersion(deps({}), "/w");
		expect(result).toBeUndefined();
	});
});
