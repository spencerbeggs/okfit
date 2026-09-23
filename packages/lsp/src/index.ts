/**
 * `@okfit/lsp`: the okfit language server. The bin is `okfit-lsp`; this
 * barrel exposes the transport seam and the server program for embedding
 * and tests.
 *
 * @packageDocumentation
 */
export { SEVERITY, sourceTextOf, toLspDiagnostic } from "./convert/diagnostic.js";
export { pathToUri, uriToPath } from "./convert/uri.js";
export { LspError } from "./errors.js";
export type { DiagnosticsFeature, RevalidatePublisher } from "./features/diagnostics.js";
export { makeDiagnosticsFeature, makeRevalidatePublisher } from "./features/diagnostics.js";
export type { DocumentEvent } from "./features/documentSync.js";
export { registerDocumentSync } from "./features/documentSync.js";
export type { ListenOutcome, LspTransportShape } from "./protocol/LspTransport.js";
export { LspTransport } from "./protocol/LspTransport.js";
export type { ReferenceTransportOptions } from "./protocol/reference.js";
export { makeReferenceTransport } from "./protocol/reference.js";
export type {
	DidChangeTextDocumentParams,
	DidChangeWatchedFilesParams,
	DidChangeWorkspaceFoldersParams,
	DidCloseTextDocumentParams,
	DidOpenTextDocumentParams,
	DidSaveTextDocumentParams,
	InitializeParams,
	InitializeResult,
	LspDiagnostic,
	WorkspaceFolder,
} from "./protocol/types.js";
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
