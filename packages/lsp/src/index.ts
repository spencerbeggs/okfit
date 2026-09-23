/**
 * `@okfit/lsp`: the okfit language server. The bin is `okfit-lsp`; this
 * barrel exposes the transport seam and the server program for embedding
 * and tests.
 *
 * @packageDocumentation
 */
export { LspError } from "./errors.js";
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
export { LSP_VERSION } from "./version.js";
