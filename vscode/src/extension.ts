import { defineExtension, defineLogger, useDisposable } from "reactive-vscode";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { startClient } from "./client.js";
import { registerCommands } from "./commands.js";
import { createSerialQueue } from "./serial-queue.js";
import { statusFor } from "./status.js";
import { ConceptDecorations } from "./tree/decorations.js";
import type { TreeNode } from "./tree/model.js";
import { ConceptsProvider } from "./tree/provider.js";
import type { ConceptsResult } from "./tree/wire.js";
import { OKFIT_COMMANDS } from "./tree/wire.js";

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

const stopQuietly = async (
	client: LanguageClient | undefined,
	watchers: ReadonlyArray<vscode.Disposable>,
): Promise<void> => {
	try {
		await client?.stop();
	} catch (error) {
		// Best-effort cleanup: a `stop()` failure (e.g. the process already
		// died) is not worth a user-facing dialog, only a log line.
		logger.error(error instanceof Error ? error : String(error));
	} finally {
		// `client.ts`'s `startClient` never gets these disposed for free --
		// `LanguageClient` does not own a raw `synchronize.fileEvents`
		// watcher (see `client.ts`'s `createWatchers`) -- so every stop,
		// successful or not, disposes them here.
		for (const watcher of watchers) watcher.dispose();
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
	let watchers: ReadonlyArray<vscode.Disposable> = [];
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

	const clearStatus = () => {
		statusItem.text = "";
		statusItem.severity = vscode.LanguageStatusSeverity.Information;
		statusItem.selector = NO_BUNDLE_SELECTOR;
	};

	const updateStatus = () => {
		const documentUri = vscode.window.activeTextEditor?.document.uri.toString();
		const result = provider?.current;
		if (documentUri === undefined || result === undefined) {
			clearStatus();
			return;
		}
		const diagnostics = vscode.languages
			.getDiagnostics()
			.flatMap(([uri, diags]) => diags.map((d) => ({ uri: uri.toString(), severity: d.severity })));
		// `bundle.rootUri` is Node's `pathToFileURL(root).href` (never
		// percent-encoded), while `documentUri` and every diagnostic's `uri`
		// above are VS Code's own `Uri.toString()` (percent-encodes `:`, `@`,
		// `+`, `!`, `&`, `=`, and lowercases Windows drive letters). Re-parsing
		// `rootUri` through `vscode.Uri` before it reaches `statusFor` puts both
		// sides through the same encoding, the same way `decorations.ts`
		// already normalizes concept URIs; `statusFor` itself stays pure and
		// only ever sees already-normalized strings.
		const normalizedResult: ConceptsResult = {
			bundles: result.bundles.map((b) => ({ ...b, rootUri: vscode.Uri.parse(b.rootUri).toString() })),
		};
		const status = statusFor({ documentUri, result: normalizedResult, diagnostics });
		if (status === undefined) {
			clearStatus();
			return;
		}
		statusItem.text = status.text;
		statusItem.detail = status.detail;
		statusItem.severity = statusSeverity(status.severity);
		// `status.detail` is a plain fsPath (`bundle.root`); building the
		// selector from `vscode.Uri.file` + `RelativePattern` instead of
		// interpolating it into a glob string keeps this correct on Windows
		// (backslashes) and for roots containing `[`, `{` or `*`.
		statusItem.selector = [{ pattern: new vscode.RelativePattern(vscode.Uri.file(status.detail), "**") }];
	};

	// `okfit.isConcept`: true when the active editor's document is one of the
	// current `okfit/concepts` result's concepts (Task 6 decision 3) --
	// re-normalized through `vscode.Uri.parse(...).toString()` the same way
	// `updateStatus`'s `normalizedResult` re-normalizes `rootUri`, since a
	// concept's `uri` comes from the server's own `pathToUri` (never
	// percent-encoded) while `documentUri` is VS Code's own `Uri.toString()`.
	const updateIsConcept = async (): Promise<void> => {
		const documentUri = vscode.window.activeTextEditor?.document.uri.toString();
		const result = provider?.current;
		const isConcept =
			documentUri !== undefined &&
			(result?.bundles.some((b) => b.concepts.some((c) => vscode.Uri.parse(c.uri).toString() === documentUri)) ??
				false);
		await vscode.commands.executeCommand("setContext", "okfit.isConcept", isConcept);
	};
	const refreshContexts = () => {
		updateStatus();
		void updateIsConcept();
	};
	useDisposable(vscode.window.onDidChangeActiveTextEditor(() => refreshContexts()));
	useDisposable(vscode.languages.onDidChangeDiagnostics(() => updateStatus()));

	registerCommands(
		() => provider,
		() => client,
		logger.info,
	);

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

	// Disables the palette/tree-menu actions, tears down the tree and the
	// client, and clears `client`/`watchers` -- shared by `dispose()` and
	// `restart()` below, whose only difference is that `restart()` starts a
	// fresh client afterward. Disabling `okfit.hasActions` and clearing
	// `client` up front (not after the teardown completes) means every
	// command in `commands.ts` sees "server not running" for the whole
	// stop-then-start window, not just once it is over.
	const stopServer = async () => {
		await vscode.commands.executeCommand("setContext", "okfit.hasActions", false);
		disposeTree();
		await stopQuietly(client, watchers);
		client = undefined;
		watchers = [];
	};

	const start = async () => {
		const started = await startClient({
			extensionUri: context.extensionUri,
			log: logger.info,
			show: logger.show,
		});
		client = started.client;
		watchers = started.watchers;
		// `okfit.hasActions`: true only when the server advertises all three
		// `OKFIT_COMMANDS` ids in `executeCommandProvider.commands` (Task 6
		// decision 2) -- read once, right after start, independent of
		// `okfit/concepts` support below (a server can advertise commands
		// without the concept explorer, or vice versa).
		const advertised = started.client.initializeResult?.capabilities.executeCommandProvider?.commands;
		const hasActions = OKFIT_COMMANDS.every((command) => advertised?.includes(command) ?? false);
		await vscode.commands.executeCommand("setContext", "okfit.hasActions", hasActions);
		if (!hasActions) {
			logger.info(
				`okfit language server (${started.launch.source}: ${started.launch.kind === "command" ? started.launch.command : started.launch.module}) does not advertise ${OKFIT_COMMANDS.join(", ")} -- Set Status and Mark Verified stay disabled.`,
			);
		}
		// Feature-detect `okfit/concepts` instead of assuming it: any project
		// whose `okfit.lsp.serverPath`, or workspace `node_modules/.bin/okfit-lsp`
		// (or an `@okfit/plugin` wrapping it), resolves to `@okfit/lsp` <= 0.2.0
		// advertises no `experimental.okfitConcepts` capability -- the server
		// predates the concept explorer, and calling `okfit/concepts` on it
		// would fail with MethodNotFound. Diagnostics, hover and navigation come
		// from the language client itself and keep working regardless; only the
		// tree view is skipped.
		const supportsConcepts = started.client.initializeResult?.capabilities.experimental?.okfitConcepts === true;
		if (!supportsConcepts) {
			logger.info(
				`okfit language server (${started.launch.source}: ${started.launch.kind === "command" ? started.launch.command : started.launch.module}) predates the concept explorer -- OKF Concepts stays empty until @okfit/lsp is upgraded or okfit.lsp.serverPath is cleared.`,
			);
			await vscode.commands.executeCommand("setContext", "okfit.hasBundle", false);
			await vscode.commands.executeCommand("setContext", "okfit.serverTooOld", true);
			return;
		}
		await vscode.commands.executeCommand("setContext", "okfit.serverTooOld", false);
		provider = new ConceptsProvider(client, decorations, logger.error);
		view = vscode.window.createTreeView<TreeNode>("okfit.concepts", {
			treeDataProvider: provider,
			showCollapseAll: true,
		});
		provider.attach(view);
		providerSubscription = provider.onDidChangeTreeData(() => refreshContexts());
	};
	// A restart trigger's callback is not itself serialized against
	// overlapping invocations -- two rapid `okfit.lsp.serverPath` edits would
	// otherwise both call `stop()`/`start()` concurrently and leak a client.
	// Every restart (and the final stop on deactivation) goes through one
	// `SerialQueue` so at most one is ever in flight.
	const queue = createSerialQueue();
	useDisposable({
		dispose: () =>
			void queue.run(async () => {
				// Same staleness fix as `restart()` below, via `stopServer()`: so
				// nothing left running after `dispose()` can observe a stopped
				// client through `getClient()`.
				await stopServer();
			}),
	});

	// Shared by both restart triggers below (a resource-scoped
	// `okfit.lsp.serverPath` change on any folder, and a folder being added
	// or removed). `startClient` already logs and shows a dialog on its own
	// failure (client.ts); swallow the rejection here so it does not also
	// surface as an unhandled promise rejection -- the next trigger is this
	// extension's only retry path, never automatic. The old provider and
	// view are disposed here, inside the same queued restart, before the new
	// client (and its own provider and view) is started.
	const restart = () => {
		void queue
			.run(async () => {
				// `okfit.hasActions` and `client` used to go stale for the
				// stop-then-start window: the palette and tree-menu entries
				// stayed enabled and `getClient()` kept returning the stopped
				// client, so an invocation during a restart surfaced a spurious
				// transport error instead of a quiet no-op. `stopServer()` clears
				// both up front -- before `start()` (which may itself fail and
				// leave both unset) has a chance to run.
				await stopServer();
				await start();
			})
			.catch(() => undefined)
			.then(() => refreshContexts());
	};

	// Registered *before* the first `start()` runs (decision I4): a broken
	// `okfit.lsp.serverPath` (or an unusable workspace bin) failing the first
	// start used to reject the whole activation promise before this listener
	// existed, leaving the user no recovery short of a window reload. Now the
	// setting is watched first, so editing it back is always the recovery
	// path -- for the first start exactly as for every later one.
	//
	// `okfit.lsp.serverPath` is `scope: "resource"` (`package.json`), so this
	// is the only trigger for an edit to it -- a per-folder
	// `.vscode/settings.json`, the Workspace tab of a multi-root
	// `.code-workspace`, or a window-level User setting all fire
	// `onDidChangeConfiguration` with this same key, and `startClient` reads
	// the setting per folder from `vscode.workspace.getConfiguration`
	// directly (client.ts), not through a reactive proxy -- so one listener
	// on the raw event, rather than a second reactive `watch` over a
	// window-level proxy, is both necessary and sufficient. (A `config.ts`
	// reactive proxy plus this listener used to fire two restarts per edit;
	// `config.ts` was removed for exactly that reason.)
	useDisposable(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("okfit.lsp.serverPath")) restart();
		}),
	);
	// A folder added to (or removed from) a multi-root workspace can bring a
	// better `node_modules/.bin/okfit-lsp` or a different resource-scoped
	// `okfit.lsp.serverPath` into the candidate list `startClient` builds from
	// `vscode.workspace.workspaceFolders` -- restart to re-resolve it.
	useDisposable(vscode.workspace.onDidChangeWorkspaceFolders(restart));
	// The first start runs through the same queue as every restart, and never
	// rejects out of it -- `startClient` already logs and shows its own
	// failure dialog -- so activation always resolves; the listener above,
	// already registered, is the recovery path for a failed first start.
	await queue.run(start).catch(() => undefined);
	refreshContexts();
});
