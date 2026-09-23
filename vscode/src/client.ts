import { existsSync } from "node:fs";
import * as vscode from "vscode";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { CONFIG_GLOB } from "./config-glob.js";
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

export interface ClientDeps {
	readonly extensionUri: vscode.Uri;
	readonly settingPath: string | undefined;
	readonly log: (message: string) => void;
	/** Reveals the "okfit" output channel; wired to `defineLogger`'s `show`. */
	readonly show: () => void;
}

const targetOf = (launch: ServerLaunch): string => (launch.kind === "command" ? launch.command : launch.module);

/** Builds and starts the one language client for this window. The caller owns disposal via `client.stop()`. */
export const startClient = async (deps: ClientDeps): Promise<LanguageClient> => {
	const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
	const bundledModule = vscode.Uri.joinPath(deps.extensionUri, "dist", "server.js").fsPath;
	const { launch, notes } = resolveServer({
		settingPath: deps.settingPath,
		folders,
		bundledModule,
		exists: existsSync,
	});
	for (const note of notes) deps.log(note);
	deps.log(`okfit language server: ${launch.source} (${targetOf(launch)})`);

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: "file", language: "markdown" },
			{ scheme: "file", pattern: CONFIG_GLOB },
		],
		synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher(CONFIG_GLOB) },
		outputChannelName: "okfit language server",
	};
	const client = new LanguageClient("okfit.lsp", "okfit language server", serverOptions(launch), clientOptions);
	try {
		await client.start();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// `client.start()`'s own failure surfaces to the user only as a generic
		// vscode-languageclient error and VS Code's "activation failed" toast,
		// with no mention of which of the three resolution sources (setting,
		// workspace, bundled) or which path it tried -- log that here, then
		// show exactly one dialog with an action to open the channel that has
		// it. No retry: the caller (extension.ts) re-attempts only on the
		// next explicit `okfit.lsp.serverPath` change, never automatically.
		deps.log(`okfit language server failed to start (${launch.source}: ${targetOf(launch)}): ${message}`);
		void vscode.window
			.showErrorMessage(`okfit language server failed to start (${launch.source}: ${targetOf(launch)}).`, "Open Output")
			.then((selection) => {
				if (selection === "Open Output") deps.show();
			});
		throw error;
	}
	return client;
};
