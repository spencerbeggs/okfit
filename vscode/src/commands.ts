import { useCommand } from "reactive-vscode";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { conceptUriFrom, statusPicks } from "./status-picks.js";
import type { Status } from "./tree/model.js";
import type { ConceptsProvider } from "./tree/provider.js";

/**
 * `ApplyWorkspaceEditResult`'s shape, copied rather than imported from
 * `vscode-languageserver` (only `vscode-languageclient` is a dependency of
 * this extension) -- `okfit.setStatus` and `okfit.markVerified` answer with
 * this verbatim (`packages/lsp/src/features/commands.ts`).
 */
interface ApplyWorkspaceEditResult {
	readonly applied: boolean;
	readonly failureReason?: string;
}

const activeDocumentUri = (): string | undefined => vscode.window.activeTextEditor?.document.uri.toString();

/** Whether `client` advertises `command` in `executeCommandProvider.commands`. */
const supportsCommand = (client: LanguageClient, command: string): boolean =>
	client.initializeResult?.capabilities.executeCommandProvider?.commands?.includes(command) ?? false;

const executeOnServer = <R>(client: LanguageClient, command: string, args: ReadonlyArray<unknown>): Promise<R> =>
	client.sendRequest<R>("workspace/executeCommand", { command, arguments: [...args] });

/** Runs a server-applied edit command and surfaces a failure -- `applied: false` or a transport error -- as one error dialog. Shared by `okfit.setStatus` and `okfit.markVerified`, the extension's only two commands with this shape. */
const runEditCommand = async (
	client: LanguageClient,
	command: string,
	args: ReadonlyArray<unknown>,
	fallbackMessage: string,
): Promise<void> => {
	try {
		const result = await executeOnServer<ApplyWorkspaceEditResult>(client, command, args);
		if (!result.applied) void vscode.window.showErrorMessage(result.failureReason ?? fallbackMessage);
	} catch (error) {
		void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
	}
};

const statusOf = (provider: ConceptsProvider | undefined, uri: string): Status | undefined => {
	const target = vscode.Uri.parse(uri).toString();
	for (const bundle of provider?.current.bundles ?? []) {
		for (const concept of bundle.concepts) {
			if (vscode.Uri.parse(concept.uri).toString() === target) return concept.status;
		}
	}
	return undefined;
};

/**
 * Registers `okfit.validateBundle`, `okfit.openConcept`, `okfit.setStatus`
 * and `okfit.markVerified`. `getClient` and `getProvider` are read fresh on
 * every invocation rather than captured once -- both are rebuilt on every
 * language-client restart (`extension.ts`).
 */
export const registerCommands = (
	getProvider: () => ConceptsProvider | undefined,
	getClient: () => LanguageClient | undefined,
	log: (message: string) => void,
): void => {
	/** The server revalidates on watched-file and document events already; this re-requests the concept list and re-publishes the tree. When the server advertises `okfit.revalidate` (LSP roadmap phase 5), it is asked to run a fresh `full` revalidate first; an older server that does not falls back to the refresh-only behaviour. */
	useCommand("okfit.validateBundle", async () => {
		const client = getClient();
		if (client === undefined) {
			// `client` is undefined while a restart is in flight (or once the
			// extension has been deactivated) -- `extension.ts` clears it
			// right after stopping the old one, before starting the next.
			// Quiet log line, no dialog: the tree refresh below is still a
			// reasonable no-op response to an otherwise-disabled command.
			log("okfit language server is not running -- Validate Bundle only refreshes the tree.");
		} else if (supportsCommand(client, "okfit.revalidate")) {
			await executeOnServer(client, "okfit.revalidate", []);
		} else {
			log("okfit language server does not advertise okfit.revalidate -- Validate Bundle only refreshes the tree.");
		}
		await getProvider()?.refresh();
	});

	useCommand("okfit.openConcept", async () => {
		const current = getProvider()?.current;
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

	/** Quick pick over the two statuses the concept does not already have (`status-picks.ts`), then `workspace/executeCommand` `okfit.setStatus [uri, status]`. */
	useCommand("okfit.setStatus", async (arg?: unknown) => {
		const client = getClient();
		if (client === undefined) {
			// See `okfit.validateBundle` above: undefined during a restart or
			// after deactivation. The `when` clause already disables this
			// command's palette/menu entries on `okfit.hasActions`, so an
			// invocation here only happens via a direct
			// `commands.executeCommand` call -- a quiet log line, not a dialog.
			log("okfit language server is not running -- Set Status is unavailable.");
			return;
		}
		const uri = conceptUriFrom(arg, activeDocumentUri());
		if (uri === undefined) return;
		const picks = statusPicks(statusOf(getProvider(), uri));
		const picked = await vscode.window.showQuickPick(
			picks.map((pick) => ({ label: pick.label, description: pick.description })),
			{ placeHolder: "Set status" },
		);
		if (picked === undefined) return;
		await runEditCommand(client, "okfit.setStatus", [uri, picked.label], "okfit.setStatus failed.");
	});

	/** `workspace/executeCommand` `okfit.markVerified [uri]`; the server resolves the human actor and computes the edit. */
	useCommand("okfit.markVerified", async (arg?: unknown) => {
		const client = getClient();
		if (client === undefined) {
			log("okfit language server is not running -- Mark Verified is unavailable.");
			return;
		}
		const uri = conceptUriFrom(arg, activeDocumentUri());
		if (uri === undefined) return;
		await runEditCommand(client, "okfit.markVerified", [uri], "okfit.markVerified failed.");
	});
};
