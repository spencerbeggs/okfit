import * as vscode from "vscode";
import type { TreeNode } from "./model.js";
import { decorationFor } from "./model.js";

/** Badges concept files in the explorer tree (and the file explorer) by status and staleness. */
export class ConceptDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly changed = new vscode.EventEmitter<undefined>();
	readonly onDidChangeFileDecorations = this.changed.event;
	private byUri = new Map<string, Extract<TreeNode, { kind: "concept" }>>();

	update(roots: ReadonlyArray<TreeNode>): void {
		const next = new Map<string, Extract<TreeNode, { kind: "concept" }>>();
		const walk = (nodes: ReadonlyArray<TreeNode>) => {
			for (const n of nodes) n.kind === "concept" ? next.set(vscode.Uri.parse(n.uri).toString(), n) : walk(n.children);
		};
		walk(roots);
		this.byUri = next;
		this.changed.fire(undefined);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		const node = this.byUri.get(uri.toString());
		const dec = node && decorationFor(node);
		if (!dec) return undefined;
		const color = node.stale
			? new vscode.ThemeColor("list.warningForeground")
			: new vscode.ThemeColor("descriptionForeground");
		return new vscode.FileDecoration(dec.badge, dec.tooltip, color);
	}

	dispose(): void {
		this.changed.dispose();
	}
}
