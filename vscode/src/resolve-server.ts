import { join } from "node:path";

export type ServerLaunch =
	| {
			readonly kind: "command";
			readonly command: string;
			readonly args: ReadonlyArray<string>;
			readonly source: "setting" | "workspace" | "bundled-path-node";
	  }
	| { readonly kind: "module"; readonly module: string; readonly source: "bundled" };

export interface ResolveFolder {
	/** A workspace folder's `fsPath`. */
	readonly path: string;
	/** `okfit.lsp.serverPath` read with this folder's `Uri` as the resource, if set. */
	readonly settingPath: string | undefined;
}

export interface ResolveInput {
	readonly folders: ReadonlyArray<ResolveFolder>;
	readonly bundledModule: string;
	readonly exists: (path: string) => boolean;
	/** Resolves symlinks so two folders that share one on-disk `okfit-lsp` dedupe to one candidate. */
	readonly realPath: (path: string) => string;
	/** `process.versions.node` of the extension host process; decides the bundled launch shape below. */
	readonly hostNode: string;
}

export interface Resolution {
	/** Every viable launch, in priority order. Never empty: the bundled launch is always the last entry. */
	readonly candidates: ReadonlyArray<ServerLaunch>;
	readonly notes: ReadonlyArray<string>;
}

/**
 * `@okfit/lsp`'s own `engines.node` floor. The bundled source is launched
 * in-process (`{ module }`) only when the extension host's own Node
 * satisfies this; VS Code 1.100+ was probed only on Node 24.18.1
 * (`okf/modules/vscode-extension.md`'s Server resolution section), and
 * `engines.vscode: ^1.100.0` admits older-Node hosts (older VS Code
 * releases, and forks such as VSCodium or Cursor that lag upstream) without
 * verifying them.
 */
export const BUNDLED_NODE_FLOOR = "24.11.0";

/** Parses a `major.minor.patch` string; a missing or non-numeric segment reads as `0`. */
const parseVersion = (version: string): readonly [number, number, number] => {
	const [major, minor, patch] = version.split(".", 3).map((part) => Number.parseInt(part, 10) || 0);
	return [major ?? 0, minor ?? 0, patch ?? 0];
};

/** Whether `version` is `>= floor`, comparing `major`, then `minor`, then `patch` numerically. No dependency. */
const atLeast = (version: string, floor: string): boolean => {
	const v = parseVersion(version);
	const f = parseVersion(floor);
	for (let i = 0; i < 3; i += 1) {
		const a = v[i] as number;
		const b = f[i] as number;
		if (a !== b) return a > b;
	}
	return true;
};

/**
 * Builds the full priority-ordered candidate list: every folder's
 * `okfit.lsp.serverPath` that exists (window order), then every folder's
 * `node_modules/.bin/okfit-lsp` that exists (window order, deduped by real
 * path), then the bundled launch. Pure; never returns an empty list.
 */
export const resolveServer = (input: ResolveInput): Resolution => {
	const notes: Array<string> = [];
	const candidates: Array<ServerLaunch> = [];

	for (const folder of input.folders) {
		const setting = folder.settingPath?.trim();
		if (setting === undefined || setting === "") continue;
		if (input.exists(setting)) {
			candidates.push({ kind: "command", command: setting, args: ["--stdio"], source: "setting" });
		} else {
			notes.push(`okfit.lsp.serverPath is set to ${setting}, which does not exist; falling back.`);
		}
	}

	const seenRealPaths = new Set<string>();
	for (const folder of input.folders) {
		const local = join(folder.path, "node_modules", ".bin", "okfit-lsp");
		if (!input.exists(local)) continue;
		const real = input.realPath(local);
		if (seenRealPaths.has(real)) continue;
		seenRealPaths.add(real);
		candidates.push({ kind: "command", command: local, args: ["--stdio"], source: "workspace" });
	}

	if (atLeast(input.hostNode, BUNDLED_NODE_FLOOR)) {
		candidates.push({ kind: "module", module: input.bundledModule, source: "bundled" });
	} else {
		notes.push(
			`Extension host Node ${input.hostNode} is older than @okfit/lsp's engines.node floor (${BUNDLED_NODE_FLOOR}); launching the bundled server with a PATH node instead of an in-process module.`,
		);
		candidates.push({
			kind: "command",
			command: "node",
			args: [input.bundledModule, "--stdio"],
			source: "bundled-path-node",
		});
	}

	return { candidates, notes };
};
