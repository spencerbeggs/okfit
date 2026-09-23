import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { ConceptDecorations } from "./decorations.js";
import type { TreeNode } from "./model.js";
import { buildTree, iconFor, shouldApplyRefresh, staleCount } from "./model.js";
import type { ConceptsResult } from "./wire.js";
import { BUNDLE_CHANGED_NOTIFICATION, CONCEPTS_REQUEST } from "./wire.js";

/**
 * `vscode.TreeDataProvider` for the "OKF Concepts" explorer view. Built once
 * per client (Task 4 brief decision 3): a restart disposes the previous
 * provider and view, then rebuilds both against the new client, inside the
 * same queued restart that replaces the client itself.
 */
export class ConceptsProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData = this.changed.event;
	private result: ConceptsResult = { bundles: [] };
	private roots: ReadonlyArray<TreeNode> = [];
	private readonly subscriptions: Array<vscode.Disposable> = [];

	private view: vscode.TreeView<TreeNode> | undefined;
	// Bumped by every `refresh()` call; a resolving request applies its
	// result only when its own generation is still the current one, so an
	// earlier, slower `sendRequest` that resolves after a later one (the
	// `bundleChanged` handler and `attach()` can both fire `refresh()`
	// without waiting on each other) cannot clobber a newer result or badge.
	private generation = 0;
	private disposed = false;

	constructor(
		private readonly client: LanguageClient,
		private readonly decorations: ConceptDecorations,
		private readonly log: (error: string | Error) => void,
	) {
		this.subscriptions.push(client.onNotification(BUNDLE_CHANGED_NOTIFICATION, () => void this.refresh()));
	}

	/** Called once right after `createTreeView`; the badge needs the view and the view needs this provider. */
	attach(view: vscode.TreeView<TreeNode>): void {
		this.view = view;
		void this.refresh();
	}

	get current(): ConceptsResult {
		return this.result;
	}

	async refresh(): Promise<void> {
		const generation = ++this.generation;
		let result: ConceptsResult;
		try {
			result = await this.client.sendRequest<ConceptsResult>(CONCEPTS_REQUEST, {});
		} catch (error) {
			// A request on a stopping or already-stopped client (a restart's
			// `disposeTree()` + `stopQuietly()` raced this call) rejects; log
			// it once instead of letting it surface as an unhandled rejection,
			// but only while the provider is still meant to be live -- once
			// `dispose()` has run, the rejection is expected noise from
			// teardown, not something worth a log line.
			if (!this.disposed) this.log(error instanceof Error ? error : String(error));
			return;
		}
		// The request may have resolved after a later `refresh()` started (or
		// after this provider was disposed mid-flight); either way, an
		// out-of-order or torn-down result must never overwrite a newer one
		// or write into a disposed view.
		if (!shouldApplyRefresh(generation, this.generation, this.disposed)) return;
		this.result = result;
		this.roots = buildTree(this.result);
		this.decorations.update(this.roots);
		const stale = staleCount(this.result);
		if (this.view !== undefined) {
			this.view.badge =
				stale > 0 ? { value: stale, tooltip: `${stale} stale concept${stale === 1 ? "" : "s"}` } : undefined;
		}
		await vscode.commands.executeCommand("setContext", "okfit.hasBundle", this.result.bundles.length > 0);
		this.changed.fire(undefined);
	}

	getChildren(node?: TreeNode): Array<TreeNode> {
		if (node === undefined) return [...this.roots];
		return node.kind === "concept" ? [] : [...node.children];
	}

	getTreeItem(node: TreeNode): vscode.TreeItem {
		if (node.kind === "concept") {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
			item.id = `${node.uri}`;
			item.description = node.description;
			item.resourceUri = vscode.Uri.parse(node.uri);
			item.iconPath = new vscode.ThemeIcon(iconFor(node.type));
			item.contextValue = "okfit.concept";
			item.tooltip = `${node.type} · ${node.id}`;
			item.command = { command: "vscode.open", title: "Open", arguments: [item.resourceUri] };
			return item;
		}
		const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
		item.id = node.kind === "type" ? `${node.root}::${node.type}` : node.root;
		item.description = node.kind === "type" ? String(node.count) : node.description;
		item.iconPath = new vscode.ThemeIcon(node.kind === "type" ? iconFor(node.type) : "root-folder");
		item.contextValue = node.kind === "type" ? "okfit.type" : "okfit.bundle";
		return item;
	}

	dispose(): void {
		this.disposed = true;
		for (const s of this.subscriptions) s.dispose();
		this.changed.dispose();
	}
}
