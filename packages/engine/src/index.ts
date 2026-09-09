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
	InitOverwriteError,
	VerifyConceptNotFoundError,
	VerifyUnsupportedFrontmatterError,
} from "./errors.js";
export type { ScaffoldFile, ScaffoldOptions } from "./init/scaffold.js";
export { CONFIG_RELATIVE_PATH, SCHEMA_DIRECTIVE, configValue, files, targetPaths } from "./init/scaffold.js";
export { ContextEnvelope, ContextTag, ContextType, contextEnvelope } from "./render/context.js";
export type { Tally } from "./render/exit.js";
export { forDiagnostics, tally } from "./render/exit.js";
export { JsonDiagnostic, JsonEnvelope, JsonErrorEnvelope, JsonSummary, json, jsonError } from "./render/json.js";
export type { DiagnosticSource, RenderedDiagnostic } from "./render/sort.js";
export { collect, sort } from "./render/sort.js";
export { SyncEnvelope, SyncModeEnvelope, syncEnvelope } from "./render/sync.js";
export { VerifyEnvelope, verifyEnvelope } from "./render/verify.js";
export type { SyncMode, SyncModeResult, SyncOptions, SyncResult } from "./sync/run.js";
export { SkipReason, runSync } from "./sync/run.js";
export type { RunOptions, RunResult } from "./validate/run.js";
export { Now, run } from "./validate/run.js";
export type { VerifyOptions, VerifyResult } from "./verify/run.js";
export { runVerify } from "./verify/run.js";
