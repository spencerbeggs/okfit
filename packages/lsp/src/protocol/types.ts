/**
 * The LSP protocol types the seam and the features speak, re-exported as
 * types only. The library re-exports `vscode-languageserver-protocol` from
 * its root entry, which is the one this package depends on directly; nothing
 * here is a runtime value, so importing this file never loads the library.
 *
 * @packageDocumentation
 */
export type {
	/** @public */
	Diagnostic as LspDiagnostic,
	/** @public */
	DidChangeTextDocumentParams,
	/** @public */
	DidChangeWatchedFilesParams,
	/** @public */
	DidChangeWorkspaceFoldersParams,
	/** @public */
	DidCloseTextDocumentParams,
	/** @public */
	DidOpenTextDocumentParams,
	/** @public */
	DidSaveTextDocumentParams,
	/** @public */
	InitializeParams,
	/** @public */
	InitializeResult,
	/** @public */
	WorkspaceFolder,
} from "vscode-languageserver";
