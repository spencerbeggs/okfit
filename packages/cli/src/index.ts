/**
 * Programmatic surface of the okfit command line: the pure pieces
 * `@okfit/mcp` and a future GitHub Action reuse directly, plus the CLI's own
 * typed errors (K-48).
 *
 * @packageDocumentation
 */

export type { ConfigReadError } from "@effected/config-file";
export {
	ConfigMalformedError,
	ConfigPathNotFoundError,
	InitOverwriteError,
	VerifyConceptNotFoundError,
	VerifyUnsupportedFrontmatterError,
} from "@okfit/engine";
export { rootCommand } from "./commands/root.js";
export type { DiscoveredConfig } from "./config/anchor.js";
export { resolveBundleRoot, resolveProjectRoot } from "./config/anchor.js";
export { buildConfigLayer, provideConfig } from "./config/layer.js";
export type { ResolveProjectConfigInput, ResolvedProjectConfig } from "./config/resolve.js";
export { DEFAULT_PROFILE_NAME, resolveProjectConfig } from "./config/resolve.js";
export type { ContextResult, ContextRunOptions } from "./context/run.js";
export { runContext } from "./context/run.js";
export { renderFailure } from "./errors.js";
export type { ScaffoldFile, ScaffoldOptions } from "./init/scaffold.js";
export { CONFIG_RELATIVE_PATH, configValue, files, targetPaths } from "./init/scaffold.js";
export { ContextEnvelope, ContextTag, ContextType, contextEnvelope, humanContext } from "./render/context.js";
export type { Tally } from "./render/exit.js";
export { forDiagnostics, tally } from "./render/exit.js";
export type { Counts } from "./render/human.js";
export { human, line, summary } from "./render/human.js";
export { JsonDiagnostic, JsonEnvelope, JsonErrorEnvelope, JsonSummary, json, jsonError } from "./render/json.js";
export type { DiagnosticSource, RenderedDiagnostic } from "./render/sort.js";
export { collect, sort } from "./render/sort.js";
export type { VerifyLines } from "./render/verify.js";
export { VerifyEnvelope, humanVerify, verifyEnvelope } from "./render/verify.js";
export type { RunOptions, RunResult } from "./validate/run.js";
export { run } from "./validate/run.js";
export { CLI_VERSION } from "./version.js";
