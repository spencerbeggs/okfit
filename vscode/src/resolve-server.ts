import { join } from "node:path";

export type ServerLaunch =
	| {
			readonly kind: "command";
			readonly command: string;
			readonly args: ReadonlyArray<string>;
			readonly source: "setting" | "workspace" | "bundled-path-node";
	  }
	| { readonly kind: "module"; readonly module: string; readonly source: "bundled" };

export interface ResolveInput {
	readonly settingPath: string | undefined;
	readonly folders: ReadonlyArray<string>;
	readonly bundledModule: string;
	readonly exists: (path: string) => boolean;
	/** `process.versions.node` of the extension host process; decides the bundled launch shape below. */
	readonly hostNode: string;
}

export interface Resolution {
	readonly launch: ServerLaunch;
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

/** First hit wins: the setting, then each folder's local bin, then the bundled server. Pure. */
export const resolveServer = (input: ResolveInput): Resolution => {
	const notes: Array<string> = [];
	const setting = input.settingPath?.trim();
	if (setting !== undefined && setting !== "") {
		if (input.exists(setting)) {
			return { launch: { kind: "command", command: setting, args: ["--stdio"], source: "setting" }, notes };
		}
		notes.push(`okfit.lsp.serverPath is set to ${setting}, which does not exist; falling back.`);
	}
	for (const folder of input.folders) {
		const local = join(folder, "node_modules", ".bin", "okfit-lsp");
		if (input.exists(local)) {
			return { launch: { kind: "command", command: local, args: ["--stdio"], source: "workspace" }, notes };
		}
	}
	if (atLeast(input.hostNode, BUNDLED_NODE_FLOOR)) {
		return { launch: { kind: "module", module: input.bundledModule, source: "bundled" }, notes };
	}
	notes.push(
		`Extension host Node ${input.hostNode} is older than @okfit/lsp's engines.node floor (${BUNDLED_NODE_FLOOR}); launching the bundled server with a PATH node instead of an in-process module.`,
	);
	return {
		launch: {
			kind: "command",
			command: "node",
			args: [input.bundledModule, "--stdio"],
			source: "bundled-path-node",
		},
		notes,
	};
};
