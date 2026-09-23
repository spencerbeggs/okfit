import { defineExtension, defineLogger, useDisposable, watch } from "reactive-vscode";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { startClient } from "./client.js";
import { registerCommands } from "./commands.js";
import { config } from "./config.js";
import { createSerialQueue } from "./serial-queue.js";
import { statusFor } from "./status.js";
import { ConceptDecorations } from "./tree/decorations.js";
import type { TreeNode } from "./tree/model.js";
import { ConceptsProvider } from "./tree/provider.js";

// `createLanguageStatusItem`'s `selector` is never empty: VS Code hides an
// item only through disposal, never through an empty selector, so a document
// outside every live bundle gets routed at a pattern nothing on disk matches
// rather than tearing the item down and rebuilding it per document.
const NO_BUNDLE_SELECTOR: vscode.DocumentSelector = [{ pattern: "**/.okfit-none" }];

const statusSeverity = (severity: "error" | "warning" | "information"): vscode.LanguageStatusSeverity => {
	switch (severity) {
		case "error":
			return vscode.LanguageStatusSeverity.Error;
		case "warning":
			return vscode.LanguageStatusSeverity.Warning;
		default:
			return vscode.LanguageStatusSeverity.Information;
	}
};

// reactive-vscode@1.0.2 ships defineLogger, not the useLogger name the extension
// used before it: defineLogger(name) builds a LogOutputChannel-backed logger,
// usable before activation, and is what the F5 probe (Task 1 Step 8) reads.
const logger = defineLogger("okfit");

const stopQuietly = async (client: LanguageClient | undefined): Promise<void> => {
	try {
		await client?.stop();
	} catch (error) {
		// Best-effort cleanup: a `stop()` failure (e.g. the process already
		// died) is not worth a user-facing dialog, only a log line.
		logger.error(error instanceof Error ? error : String(error));
	}
};

// `defineExtension`'s setup callback receives the ExtensionContext as its own
// parameter (verified against reactive-vscode@1.0.2's dist/index.d.ts) --
// simpler than reading the module-scoped `extensionContext` ref the task
// brief sketched, and accepts an async setup in this version, so `start()`
// is awaited directly rather than fired-and-forgotten.
export const { activate, deactivate } = defineExtension(async (context) => {
	logger.info(
		`okfit extension activated on Node ${process.versions.node}, Electron ${process.versions.electron ?? "n/a"}`,
	);
	let client: LanguageClient | undefined;
	let provider: ConceptsProvider | undefined;
	let view: vscode.TreeView<TreeNode> | undefined;
	let providerSubscription: vscode.Disposable | undefined;

	// The decorations provider is not client-scoped -- it just relabels
	// whatever the current provider's `update` last handed it -- so it is
	// built once per activation and registered for the extension's whole
	// lifetime, unlike the tree provider and view below, which are rebuilt
	// on every client restart.
	const decorations = new ConceptDecorations();
	useDisposable(vscode.window.registerFileDecorationProvider(decorations));
	useDisposable(decorations);

	// One item for the whole activation -- VS Code hides an item only through
	// disposal, never through an empty selector or blank text, so a document
	// outside every live bundle keeps the item but routes its selector at
	// `NO_BUNDLE_SELECTOR` (decision 4) rather than tearing it down.
	const statusItem = vscode.languages.createLanguageStatusItem("okfit.status", NO_BUNDLE_SELECTOR);
	useDisposable(statusItem);
	statusItem.command = { command: "okfit.validateBundle", title: "Validate" };

	const updateStatus = () => {
		const documentUri = vscode.window.activeTextEditor?.document.uri.toString();
		const result = provider?.current;
		if (documentUri === undefined || result === undefined) {
			statusItem.text = "";
			statusItem.severity = vscode.LanguageStatusSeverity.Information;
			statusItem.selector = NO_BUNDLE_SELECTOR;
			return;
		}
		const diagnostics = vscode.languages
			.getDiagnostics()
			.flatMap(([uri, diags]) => diags.map((d) => ({ uri: uri.toString(), severity: d.severity })));
		const status = statusFor({ documentUri, result, diagnostics });
		if (status === undefined) {
			statusItem.text = "";
			statusItem.severity = vscode.LanguageStatusSeverity.Information;
			statusItem.selector = NO_BUNDLE_SELECTOR;
			return;
		}
		statusItem.text = status.text;
		statusItem.detail = status.detail;
		statusItem.severity = statusSeverity(status.severity);
		statusItem.selector = [{ pattern: `${status.detail}/**` }];
	};
	useDisposable(vscode.window.onDidChangeActiveTextEditor(() => updateStatus()));
	useDisposable(vscode.languages.onDidChangeDiagnostics(() => updateStatus()));

	registerCommands(() => provider);

	// Disposes the tree provider and view for the client that is about to be
	// replaced or stopped; called from inside the serial queue only, so it
	// never races a concurrent `start`.
	const disposeTree = () => {
		providerSubscription?.dispose();
		providerSubscription = undefined;
		view?.dispose();
		provider?.dispose();
		view = undefined;
		provider = undefined;
	};

	const start = async () => {
		client = await startClient({
			extensionUri: context.extensionUri,
			settingPath: config.serverPath,
			log: logger.info,
			show: logger.show,
		});
		provider = new ConceptsProvider(client, decorations, logger.error);
		view = vscode.window.createTreeView<TreeNode>("okfit.concepts", {
			treeDataProvider: provider,
			showCollapseAll: true,
		});
		provider.attach(view);
		providerSubscription = provider.onDidChangeTreeData(() => updateStatus());
	};
	await start();
	updateStatus();
	// `watch`'s callback is not itself serialized against overlapping
	// invocations -- two rapid `okfit.lsp.serverPath` edits would otherwise
	// both call `stop()`/`start()` concurrently and leak a client. Every
	// restart (and the final stop on deactivation) goes through one
	// `SerialQueue` so at most one is ever in flight.
	const queue = createSerialQueue();
	useDisposable({
		dispose: () =>
			void queue.run(async () => {
				disposeTree();
				await stopQuietly(client);
			}),
	});
	// `config.serverPath` is read through `defineConfig`'s reactive proxy, so a
	// getter (not the proxy itself) is what `watch` tracks: re-reading the
	// setting inside the getter establishes the `onDidChangeConfiguration`
	// dependency (see config.ts).
	watch(
		() => config.serverPath,
		() => {
			// `startClient` already logs and shows a dialog on its own failure
			// (client.ts); swallow the rejection here so it does not also
			// surface as an unhandled promise rejection -- the next setting
			// change is this extension's only retry path, never automatic.
			// The old provider and view are disposed here, inside the same
			// queued restart, before the new client (and its own provider and
			// view) is started.
			void queue
				.run(async () => {
					disposeTree();
					await stopQuietly(client);
					await start();
				})
				.catch(() => undefined);
		},
	);
});
