import { existsSync, realpathSync } from "node:fs";
import * as vscode from "vscode";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { CONFIG_GLOB } from "./config-glob.js";
import { nextCandidate } from "./next-candidate.js";
import type { ServerLaunch } from "./resolve-server.js";
import { resolveServer } from "./resolve-server.js";

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

const clientOptions = (): LanguageClientOptions => ({
	documentSelector: [
		{ scheme: "file", language: "markdown" },
		{ scheme: "file", pattern: CONFIG_GLOB },
	],
	// Two watchers: the config glob (for the server's own config-driven
	// session rebuild) and every markdown file (so a concept file created,
	// deleted or renamed outside an open editor -- Explorer, `git
	// checkout`/`pull`, a codegen run -- still reaches the server as a
	// `didChangeWatchedFiles` event; the server treats any non-config path
	// as a `full` revalidate and already debounces it). Built fresh per
	// attempt (rather than shared across candidates) since each
	// `LanguageClient` owns and disposes its own watcher disposables on
	// `stop()`.
	synchronize: {
		fileEvents: [
			vscode.workspace.createFileSystemWatcher(CONFIG_GLOB),
			vscode.workspace.createFileSystemWatcher("**/*.md"),
		],
	},
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
}

/** Best-effort real path; a folder or bin that cannot be resolved (e.g. it does not exist) keeps its own path. */
const realPath = (path: string): string => {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
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
 * of the returned client via `client.stop()`.
 */
export const startClient = async (deps: ClientDeps): Promise<StartedClient> => {
	const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
		path: folder.uri.fsPath,
		settingPath: vscode.workspace.getConfiguration("okfit.lsp", folder.uri).get<string>("serverPath"),
	}));
	const bundledModule = vscode.Uri.joinPath(deps.extensionUri, "dist", "server.js").fsPath;
	const { candidates, notes } = resolveServer({
		folders,
		bundledModule,
		exists: existsSync,
		realPath,
		hostNode: process.versions.node,
	});
	for (const note of notes) deps.log(note);

	for (let index = 0; index < candidates.length; index += 1) {
		const launch = candidates[index] as ServerLaunch;
		const isLast = index === candidates.length - 1;
		const client = new LanguageClient("okfit.lsp", "okfit language server", serverOptions(launch), clientOptions());
		try {
			await client.start();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.log(`okfit language server failed to start (${launch.source}: ${targetOf(launch)}): ${message}`);
			if (!isLast) continue;
			// `client.start()`'s own failure surfaces to the user only as a generic
			// vscode-languageclient error and VS Code's "activation failed" toast,
			// with no mention of which candidate it tried -- show exactly one
			// dialog with an action to open the channel that has that detail. Not
			// retried here: the caller (extension.ts) re-attempts on the next
			// explicit `okfit.lsp.serverPath` change, including after the very
			// first failed start -- its `watch` is registered before that first
			// attempt runs.
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
			continue;
		}

		deps.log(`okfit language server: ${launch.source} (${targetOf(launch)})`);
		return { client, launch };
	}
	// Unreachable: `resolveServer` never returns an empty candidate list, and
	// the loop above always either `return`s or `throw`s on its last
	// iteration.
	throw new Error("okfit language server: no server candidates were resolved.");
};
