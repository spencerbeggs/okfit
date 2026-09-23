import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { CONFIG_GLOB } from "./config-glob.js";
import { nextCandidate } from "./next-candidate.js";
import type { ServerLaunch } from "./resolve-server.js";
import { resolveServer } from "./resolve-server.js";
import { MIN_SERVER_VERSION } from "./versions.js";

// vscode-languageclient@10.1.1's package.json `exports` map only declares
// "./node" (types + a "node" condition), not "./node.js" -- so the bare
// specifier is "vscode-languageclient/node", no extension. This is a
// package import, not a relative one, so the repo's "relative imports use
// .js extensions" rule does not apply here (verified against
// node_modules/.pnpm/vscode-languageclient@10.1.1's package.json).

const serverOptions = (launch: ServerLaunch): ServerOptions =>
	launch.kind === "command"
		? { command: launch.command, args: [...launch.args], transport: TransportKind.stdio }
		: { module: launch.module, transport: TransportKind.stdio };

/**
 * Two watchers: the config glob (for the server's own config-driven session
 * rebuild) and every markdown file (so a concept file created, deleted or
 * renamed outside an open editor -- Explorer, `git checkout`/`pull`, a
 * codegen run -- still reaches the server as a `didChangeWatchedFiles`
 * event; the server treats any non-config path as a `full` revalidate and
 * already debounces it). Built fresh per candidate attempt, and owned by
 * the caller rather than the `LanguageClient`: `vscode-languageclient`
 * 10.1.1's `FileSystemWatcherFeature.registerRaw` (invoked by
 * `hookFileEvents`, which only runs after a successful `start()`) disposes
 * only the `onDidCreate`/`onDidChange`/`onDidDelete` listeners it attaches
 * to a raw watcher passed through `synchronize.fileEvents` -- never the
 * `FileSystemWatcher` itself (contrast `register()`, used for
 * server-driven dynamic registration, which does push the watcher it
 * creates into its own disposables). A client whose `start()` throws never
 * reaches `hookFileEvents` at all. Either way the watchers this function
 * creates outlive the client unless the caller disposes them explicitly.
 */
const createWatchers = (): ReadonlyArray<vscode.FileSystemWatcher> => [
	vscode.workspace.createFileSystemWatcher(CONFIG_GLOB),
	vscode.workspace.createFileSystemWatcher("**/*.md"),
];

const disposeAll = (disposables: ReadonlyArray<vscode.Disposable>): void => {
	for (const disposable of disposables) disposable.dispose();
};

const clientOptions = (fileEvents: ReadonlyArray<vscode.FileSystemWatcher>): LanguageClientOptions => ({
	documentSelector: [
		{ scheme: "file", language: "markdown" },
		{ scheme: "file", pattern: CONFIG_GLOB },
	],
	synchronize: { fileEvents: [...fileEvents] },
	outputChannelName: "okfit language server",
});

export interface ClientDeps {
	readonly extensionUri: vscode.Uri;
	readonly log: (message: string) => void;
	/** Reveals the "okfit" output channel; wired to `defineLogger`'s `show`. */
	readonly show: () => void;
}

const targetOf = (launch: ServerLaunch): string => (launch.kind === "command" ? launch.command : launch.module);

export interface StartedClient {
	readonly client: LanguageClient;
	readonly launch: ServerLaunch;
	/**
	 * This candidate's two `FileSystemWatcher`s -- never adopted for
	 * disposal by `LanguageClient` itself (see `createWatchers`). The
	 * caller must dispose these whenever it stops `client`, including on
	 * every later restart.
	 */
	readonly watchers: ReadonlyArray<vscode.Disposable>;
	/** Every `"workspace"` candidate `resolveServer` dropped for running an `@okfit/lsp` older than `MIN_SERVER_VERSION`. */
	readonly outdated: ReadonlyArray<{ readonly folder: string; readonly version: string }>;
}

/** Best-effort real path; a folder or bin that cannot be resolved (e.g. it does not exist) keeps its own path. */
const realPath = (path: string): string => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
};

/** Reads `package.json`'s `version` field at `path`, or `undefined` when it does not exist or does not parse. */
const readPackageVersion = (path: string): string | undefined => {
	try {
		const pkg = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown; version?: unknown };
		return typeof pkg.version === "string" ? pkg.version : undefined;
	} catch {
		return undefined;
	}
};

/** `package.json`'s `name` field at `path`, or `undefined` when it does not exist or does not parse. */
const readPackageName = (path: string): string | undefined => {
	try {
		const pkg = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown };
		return typeof pkg.name === "string" ? pkg.name : undefined;
	} catch {
		return undefined;
	}
};

/**
 * Resolves the `@okfit/lsp` version a workspace folder's
 * `node_modules/.bin/okfit-lsp` would run, without spawning it (Part A step
 * 1): first `node_modules/@okfit/lsp/package.json`'s own `version`; if that
 * does not exist, follow the bin's real path and walk up to the nearest
 * `package.json` -- when that package is `@okfit/plugin` (which re-exports
 * `okfit-lsp` as its own bin), read its own `node_modules/@okfit/lsp/
 * package.json`, or the pnpm-resolved copy one directory up from that
 * (`node_modules/@okfit/lsp` living as a sibling of the plugin package
 * inside a pnpm `.pnpm` store entry). `undefined` when no version can be
 * determined at all -- the runtime `okfit/concepts` capability gate in
 * `startClient` below still protects an unknown-version candidate.
 */
const readWorkspaceServerVersion = (folderPath: string): string | undefined => {
	const direct = readPackageVersion(join(folderPath, "node_modules", "@okfit", "lsp", "package.json"));
	if (direct !== undefined) return direct;

	const bin = join(folderPath, "node_modules", ".bin", "okfit-lsp");
	let dir: string;
	try {
		dir = dirname(realpathSync(bin));
	} catch {
		return undefined;
	}
	// Walk up from the resolved bin target to the nearest package.json.
	for (let previous: string | undefined; dir !== previous; previous = dir, dir = dirname(dir)) {
		const pkgPath = join(dir, "package.json");
		if (!existsSync(pkgPath)) continue;
		const name = readPackageName(pkgPath);
		if (name === "@okfit/plugin") {
			const nested = readPackageVersion(join(dir, "node_modules", "@okfit", "lsp", "package.json"));
			if (nested !== undefined) return nested;
			// pnpm resolves @okfit/plugin's own dependency into a sibling
			// scope directory of the store entry that holds @okfit/plugin
			// itself, rather than nesting node_modules -- try that layout too.
			return readPackageVersion(join(dir, "..", "@okfit", "lsp", "package.json"));
		}
		if (name === "@okfit/lsp") return readPackageVersion(pkgPath);
		return undefined;
	}
	return undefined;
};

/**
 * Builds and starts the one language client for this window. Tries
 * `resolveServer`'s candidates in priority order: a candidate that throws
 * on `start()`, or a `"workspace"`-sourced candidate that starts but lacks
 * the `okfit/concepts` capability, is logged and abandoned in favor of the
 * next one -- except the last candidate, whose failure always surfaces (a
 * thrown error rethrows into the caller's dialog; a missing capability is
 * kept and left to the existing `okfit.serverTooOld` UI, same as any
 * `"setting"`-sourced candidate at any position). The caller owns disposal
 * of the returned client via `client.stop()` and, separately, of the
 * returned `watchers` -- `LanguageClient` never disposes a raw
 * `synchronize.fileEvents` watcher itself (see `createWatchers`).
 */
export const startClient = async (deps: ClientDeps): Promise<StartedClient> => {
	const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
		path: folder.uri.fsPath,
		settingPath: vscode.workspace.getConfiguration("okfit.lsp", folder.uri).get<string>("serverPath"),
	}));
	const bundledModule = vscode.Uri.joinPath(deps.extensionUri, "dist", "server.js").fsPath;
	const { candidates, notes, outdated } = resolveServer({
		folders,
		bundledModule,
		exists: existsSync,
		realPath,
		hostNode: process.versions.node,
		readVersion: readWorkspaceServerVersion,
		minServerVersion: MIN_SERVER_VERSION,
	});
	for (const note of notes) deps.log(note);
	if (outdated.length > 0) {
		deps.log(
			`okfit language server: ${outdated.length} workspace folder(s) run @okfit/lsp older than ${MIN_SERVER_VERSION}: ${outdated.map((o) => `${o.folder} (${o.version})`).join(", ")}.`,
		);
	}

	for (let index = 0; index < candidates.length; index += 1) {
		const launch = candidates[index] as ServerLaunch;
		const isLast = index === candidates.length - 1;
		const watchers = createWatchers();
		const client = new LanguageClient(
			"okfit.lsp",
			"okfit language server",
			serverOptions(launch),
			clientOptions(watchers),
		);
		try {
			await client.start();
		} catch (error) {
			disposeAll(watchers);
			const message = error instanceof Error ? error.message : String(error);
			deps.log(`okfit language server failed to start (${launch.source}: ${targetOf(launch)}): ${message}`);
			if (!isLast) continue;
			// `client.start()`'s own failure surfaces to the user only as a generic
			// vscode-languageclient error and VS Code's "activation failed" toast,
			// with no mention of which candidate it tried -- show exactly one
			// dialog with an action to open the channel that has that detail. Not
			// retried here: the caller (extension.ts) re-attempts on the next
			// explicit `okfit.lsp.serverPath` change, including after the very
			// first failed start -- its `onDidChangeConfiguration` listener is
			// registered before that first attempt runs.
			void vscode.window
				.showErrorMessage(
					`okfit language server failed to start (${launch.source}: ${targetOf(launch)}).`,
					"Open Output",
				)
				.then((selection) => {
					if (selection === "Open Output") deps.show();
				});
			throw error;
		}

		// Feature-detect `okfit/concepts` instead of assuming it: any
		// `"workspace"`-sourced candidate that resolves to `@okfit/lsp` <= 0.2.0
		// advertises no `experimental.okfitConcepts` capability -- it predates
		// the concept explorer -- so fall through to the next candidate rather
		// than settling for a stale server one folder happens to ship. A
		// `"setting"` source is the user's explicit choice and is kept
		// regardless, exactly as the last candidate always is.
		const supportsConcepts = client.initializeResult?.capabilities.experimental?.okfitConcepts === true;
		if (!isLast && nextCandidate(launch.source, supportsConcepts) === "try-next") {
			deps.log(
				`okfit language server (${launch.source}: ${targetOf(launch)}) predates the concept explorer -- trying the next candidate.`,
			);
			await client.stop();
			disposeAll(watchers);
			continue;
		}

		deps.log(`okfit language server: ${launch.source} (${targetOf(launch)})`);
		return { client, launch, watchers, outdated };
	}
	// Unreachable: `resolveServer` never returns an empty candidate list, and
	// the loop above always either `return`s or `throw`s on its last
	// iteration.
	throw new Error("okfit language server: no server candidates were resolved.");
};
