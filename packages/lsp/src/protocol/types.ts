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
	ApplyWorkspaceEditParams,
	/** @public */
	ApplyWorkspaceEditResult,
	/** @public */
	CodeAction,
	/** @public */
	CodeActionContext,
	/** @public */
	CodeActionParams,
	/** @public */
	Command,
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
	ExecuteCommandParams,
	/** @public */
	Hover,
	/** @public */
	HoverParams,
	/** @public */
	InitializeParams,
	/** @public */
	InitializeResult,
	/** @public */
	InlayHint,
	/** @public */
	InlayHintParams,
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
	TextEdit,
	/** @public */
	WorkspaceEdit,
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

/**
 * The library's `CodeActionKind.QuickFix` value: a code action kind features
 * never import the enum to spell.
 *
 * @public
 */
export const CODE_ACTION_KIND_QUICKFIX = "quickfix";

/**
 * The library's `InlayHintKind.Type` value: an inlay hint kind features
 * never import the enum to spell.
 *
 * @public
 */
export const INLAY_HINT_KIND_TYPE = 1;
