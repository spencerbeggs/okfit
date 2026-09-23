import { existsSync } from "node:fs";
import * as vscode from "vscode";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import type { ServerLaunch } from "./resolve-server.js";
import { resolveServer } from "./resolve-server.js";

// vscode-languageclient@10.1.1's package.json `exports` map only declares
// "./node" (types + a "node" condition), not "./node.js" -- so the bare
// specifier is "vscode-languageclient/node", no extension. This is a
// package import, not a relative one, so the repo's "relative imports use
// .js extensions" rule does not apply here (verified against
// node_modules/.pnpm/vscode-languageclient@10.1.1's package.json).

const CONFIG_GLOB = "**/{.okfit.toml,okfit.toml,.config/okfit.toml}";

const serverOptions = (launch: ServerLaunch): ServerOptions =>
	launch.kind === "command"
		? { command: launch.command, args: [...launch.args], transport: TransportKind.stdio }
		: { module: launch.module, transport: TransportKind.stdio };

export interface ClientDeps {
	readonly extensionUri: vscode.Uri;
	readonly settingPath: string | undefined;
	readonly log: (message: string) => void;
}

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
	deps.log(`okfit language server: ${launch.source} (${launch.kind === "command" ? launch.command : launch.module})`);

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: "file", language: "markdown" },
			{ scheme: "file", pattern: CONFIG_GLOB },
		],
		synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher(CONFIG_GLOB) },
		outputChannelName: "okfit language server",
	};
	const client = new LanguageClient("okfit.lsp", "okfit language server", serverOptions(launch), clientOptions);
	await client.start();
	return client;
};
