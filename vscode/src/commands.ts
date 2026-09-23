import { useCommand } from "reactive-vscode";
import * as vscode from "vscode";
import type { ConceptsProvider } from "./tree/provider.js";

/** Validate Bundle: the server revalidates on watched-file and document events already, so this re-requests the concept list and re-publishes the tree; diagnostics are whatever the server last published. */
export const registerCommands = (provider: () => ConceptsProvider | undefined): void => {
	useCommand("okfit.validateBundle", async () => {
		await provider()?.refresh();
	});
	useCommand("okfit.openConcept", async () => {
		const current = provider()?.current;
		if (current === undefined) return;
		const items = current.bundles.flatMap((b) =>
			b.concepts.map((c) => ({ label: c.title, description: c.type, detail: c.id, uri: c.uri })),
		);
		const picked = await vscode.window.showQuickPick(items, {
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: "Open an OKF concept",
		});
		if (picked) await vscode.window.showTextDocument(vscode.Uri.parse(picked.uri));
	});
};
