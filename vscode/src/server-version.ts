import { dirname, join } from "node:path";

/**
 * Injected fs primitives for {@link readWorkspaceServerVersion}, so this
 * module needs no `node:fs` or `vscode` import and is unit-testable against
 * an in-memory file map (`__test__/server-version.test.ts`). `client.ts`
 * supplies the real `node:fs` implementations.
 *
 * @public
 */
export interface ServerVersionDeps {
	/** `path`'s file content, or `undefined` when it does not exist or cannot be read. */
	readonly readFile: (path: string) => string | undefined;
	/**
	 * Resolves symlinks; best-effort -- a path that cannot be resolved (e.g.
	 * it does not exist) keeps its own path, the same contract `client.ts`'s
	 * `realPath` gives this at the real fs.
	 */
	readonly realpath: (path: string) => string;
}

interface ParsedPackage {
	readonly name: string | undefined;
	readonly version: string | undefined;
}

/** Parses `content` as a `package.json`, reading only `name` and `version`; `undefined` on malformed JSON. */
const parsePackageJson = (content: string): ParsedPackage | undefined => {
	try {
		const pkg = JSON.parse(content) as { name?: unknown; version?: unknown };
		return {
			name: typeof pkg.name === "string" ? pkg.name : undefined,
			version: typeof pkg.version === "string" ? pkg.version : undefined,
		};
	} catch {
		return undefined;
	}
};

/** `path`'s `version` field, or `undefined` when the file does not exist or does not parse. */
const readPackageVersionAt = (deps: ServerVersionDeps, path: string): string | undefined => {
	const content = deps.readFile(path);
	return content === undefined ? undefined : parsePackageJson(content)?.version;
};

/**
 * Resolves the `@okfit/lsp` version a workspace folder's
 * `node_modules/.bin/okfit-lsp` would run, without spawning it (Part A step
 * 1): first `node_modules/@okfit/lsp/package.json`'s own `version`; if that
 * does not exist, follow the bin's real path (`deps.realpath`) and walk up
 * to the nearest `package.json` -- when that package is `@okfit/plugin`
 * (which re-exports `okfit-lsp` as its own bin), read its own
 * `node_modules/@okfit/lsp/package.json`, or, under pnpm's strict layout,
 * the sibling `@okfit/lsp` two directories up (the resolved plugin
 * directory sits at
 * `.../node_modules/.pnpm/@okfit+plugin@X/node_modules/@okfit/plugin`, so
 * two levels up -- past `plugin` and `@okfit` -- reaches that store entry's
 * own `node_modules`, where `@okfit/lsp` lives as a sibling). A
 * `package.json` found along the walk that exists but does not parse, or
 * whose `name` is neither of those two, stops the walk with `undefined`
 * rather than continuing further up -- only a missing file at that level
 * continues the walk. `undefined` when no version can be determined at all
 * -- the runtime `okfit/concepts` capability gate in `client.ts`'s
 * `startClient` still protects an unknown-version candidate.
 *
 * @public
 */
export const readWorkspaceServerVersion = (deps: ServerVersionDeps, folderPath: string): string | undefined => {
	const direct = readPackageVersionAt(deps, join(folderPath, "node_modules", "@okfit", "lsp", "package.json"));
	if (direct !== undefined) return direct;

	const bin = join(folderPath, "node_modules", ".bin", "okfit-lsp");
	let dir = dirname(deps.realpath(bin));
	// Walk up from the resolved bin target to the nearest package.json.
	for (let previous: string | undefined; dir !== previous; previous = dir, dir = dirname(dir)) {
		const pkgPath = join(dir, "package.json");
		const content = deps.readFile(pkgPath);
		if (content === undefined) continue;
		const name = parsePackageJson(content)?.name;
		if (name === "@okfit/plugin") {
			const nested = readPackageVersionAt(deps, join(dir, "node_modules", "@okfit", "lsp", "package.json"));
			if (nested !== undefined) return nested;
			return readPackageVersionAt(deps, join(dir, "..", "..", "@okfit", "lsp", "package.json"));
		}
		if (name === "@okfit/lsp") return parsePackageJson(content)?.version;
		return undefined;
	}
	return undefined;
};
