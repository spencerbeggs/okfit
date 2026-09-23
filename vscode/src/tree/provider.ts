import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { ConceptDecorations } from "./decorations.js";
import type { TreeNode } from "./model.js";
import { buildTree, iconFor, staleCount } from "./model.js";
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

	constructor(
		private readonly client: LanguageClient,
		private readonly decorations: ConceptDecorations,
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
		this.result = await this.client.sendRequest<ConceptsResult>(CONCEPTS_REQUEST, {});
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
		for (const s of this.subscriptions) s.dispose();
		this.changed.dispose();
	}
}
