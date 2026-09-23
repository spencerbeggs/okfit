/**
 * `@okfit/lsp`: the okfit language server. The bin is `okfit-lsp`; this
 * barrel exposes the transport seam and the server program for embedding
 * and tests.
 *
 * @packageDocumentation
 */
export { SEVERITY, sourceTextOf, toLspDiagnostic } from "./convert/diagnostic.js";
export { toLspLocation, toLspRange } from "./convert/range.js";
export { pathToUri, uriToPath } from "./convert/uri.js";
export { LspError } from "./errors.js";
export { registerCodeActions } from "./features/actions.js";
export type { BundleChangedParams, BundleSummary, ConceptSummary, ConceptsResult } from "./features/concepts.js";
export {
	BUNDLE_CHANGED_NOTIFICATION,
	CONCEPTS_REQUEST,
	notifyBundleChanged,
	registerConcepts,
} from "./features/concepts.js";
export type { DiagnosticsFeature, DiagnosticsPublisher, RevalidatePublisher } from "./features/diagnostics.js";
export { makeDiagnosticsFeature, makeRevalidatePublisher } from "./features/diagnostics.js";
export type { DocumentEvent } from "./features/documentSync.js";
export { registerDocumentSync } from "./features/documentSync.js";
export type { EditFailure } from "./features/edits.js";
export { describeFailure, humanActor, statusTextEdits, verifiedTextEdits } from "./features/edits.js";
export { registerHover } from "./features/hover.js";
export { OKFIT_CODE_ACTION_KINDS, OKFIT_COMMANDS } from "./features/names.js";
export { registerNavigation } from "./features/navigation.js";
export { registerWorkspaceSymbols } from "./features/symbols.js";
export type { ListenOutcome, LspTransportShape } from "./protocol/LspTransport.js";
export { LspTransport } from "./protocol/LspTransport.js";
export type { ReferenceTransportOptions } from "./protocol/reference.js";
export { makeReferenceTransport } from "./protocol/reference.js";
export type {
	CodeAction,
	CodeActionContext,
	CodeActionParams,
	DefinitionParams,
	DidChangeTextDocumentParams,
	DidChangeWatchedFilesParams,
	DidChangeWorkspaceFoldersParams,
	DidCloseTextDocumentParams,
	DidOpenTextDocumentParams,
	DidSaveTextDocumentParams,
	DocumentLink,
	DocumentLinkParams,
	Hover,
	HoverParams,
	InitializeParams,
	InitializeResult,
	Location,
	LspDiagnostic,
	MarkupContent,
	Position,
	Range,
	ReferenceParams,
	SymbolInformation,
	TextEdit,
	WorkspaceEdit,
	WorkspaceFolder,
	WorkspaceSymbolParams,
} from "./protocol/types.js";
export { CODE_ACTION_KIND_QUICKFIX, SYMBOL_KIND_OBJECT } from "./protocol/types.js";
export type { ServeOptions, ServeServices } from "./server.js";
export { serve } from "./server.js";
export type {
	SessionForOptions,
	SessionHandle,
	SessionRegistryOptions,
	SessionRegistryServices,
	SessionRegistryShape,
} from "./session/registry.js";
export { SessionRegistry, makeSessionRegistry } from "./session/registry.js";
export type { Scheduler, SchedulerOptions } from "./session/scheduler.js";
export { makeScheduler } from "./session/scheduler.js";
export { LSP_VERSION } from "./version.js";
