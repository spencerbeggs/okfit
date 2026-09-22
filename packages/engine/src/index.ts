/**
 * The okfit engine: config discovery and the validate, verify, sync, init
 * and context programs shared by the okfit CLI and the okfit MCP server.
 *
 * @packageDocumentation
 */

export type { DiscoveredConfig } from "./config/anchor.js";
export { resolveBundleRoot, resolveProjectRoot } from "./config/anchor.js";
export { buildConfigLayer, provideConfig } from "./config/layer.js";
export type { ResolveProjectConfigInput, ResolvedProjectConfig } from "./config/resolve.js";
export { DEFAULT_PROFILE_NAME, resolveProjectConfig } from "./config/resolve.js";
export type { ContextResult, ContextRunOptions } from "./context/run.js";
export { runContext } from "./context/run.js";
export {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	DocumentPathError,
	InitOverwriteError,
	SyncStagedLogError,
	VerifyConceptNotFoundError,
	VerifySelectionError,
	VerifyUnsupportedFrontmatterError,
} from "./errors.js";
export type { GraphRunOptions, GraphRunResult } from "./graph/run.js";
export { runGraph } from "./graph/run.js";
export type { ScaffoldFile, ScaffoldOptions } from "./init/scaffold.js";
export { CONFIG_RELATIVE_PATH, configValue, files, targetPaths } from "./init/scaffold.js";
export type { DocumentInput } from "./overlay/documents.js";
export { provideDocuments, resolveDocumentPath } from "./overlay/documents.js";
export type { OverlayDocument, OverlayDocumentsShape } from "./overlay/layer.js";
export { OverlayDocuments, layerOverlayFileSystem, makeOverlayFileSystem } from "./overlay/layer.js";
export { OkfitPlatform } from "./platform.js";
export {
	ContextEnvelope,
	ContextField,
	ContextFieldValue,
	ContextTag,
	ContextType,
	contextEnvelope,
} from "./render/context.js";
export type { Distribution } from "./render/distribution.js";
export { DistributionField } from "./render/distribution.js";
export type { Tally } from "./render/exit.js";
export { forDiagnostics, tally } from "./render/exit.js";
export {
	GraphEdgeEnvelope,
	GraphEnvelope,
	GraphNodeEnvelope,
	GraphSummary,
	graphEnvelope,
} from "./render/graph.js";
export { JsonDiagnostic, JsonEnvelope, JsonErrorEnvelope, JsonSummary, json, jsonError } from "./render/json.js";
export type { DiagnosticSource, RenderedDiagnostic } from "./render/sort.js";
export { collect, sort } from "./render/sort.js";
export { StaleEnvelope, StaleItem, StaleSummary, staleEnvelope } from "./render/stale.js";
export { SyncEnvelope, SyncModeEnvelope, syncEnvelope } from "./render/sync.js";
export { VerifyBatchEnvelope, VerifyEnvelope, verifyBatchEnvelope, verifyEnvelope } from "./render/verify.js";
export { withFallbackRange } from "./session/range.js";
export type { StaleRunOptions, StaleRunResult } from "./stale/run.js";
export { runStale } from "./stale/run.js";
export type { SyncMode, SyncModeResult, SyncOptions, SyncResult } from "./sync/run.js";
export { SkipReason, runSync } from "./sync/run.js";
export type { RunOptions, RunResult } from "./validate/run.js";
export { Now, run } from "./validate/run.js";
export type {
	VerifyBatchOptions,
	VerifyBatchResult,
	VerifyBatchSkipReason,
	VerifyOptions,
	VerifyResult,
} from "./verify/run.js";
export { runVerify, runVerifyBatch } from "./verify/run.js";
export { ENGINE_VERSION } from "./version.js";
