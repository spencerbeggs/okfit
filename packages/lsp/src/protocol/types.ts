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
	DefinitionParams,
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
	DocumentLink,
	/** @public */
	DocumentLinkParams,
	/** @public */
	Hover,
	/** @public */
	HoverParams,
	/** @public */
	InitializeParams,
	/** @public */
	InitializeResult,
	/** @public */
	Location,
	/** @public */
	MarkupContent,
	/** @public */
	Position,
	/** @public */
	Range,
	/** @public */
	ReferenceParams,
	/** @public */
	SymbolInformation,
	/** @public */
	WorkspaceFolder,
	/** @public */
	WorkspaceSymbolParams,
} from "vscode-languageserver";

/**
 * The numeric value of the library's `SymbolKind.Object` (19): a workspace
 * symbol's `kind` for every concept (decision 7 of the phase 4 plan).
 * Features never import the library's enums, so the value is spelled out
 * here as a named constant instead.
 *
 * @public
 */
export const SYMBOL_KIND_OBJECT = 19;
