/**
 * Programmatic surface of the okfit command line: the pure pieces
 * `@okfit/mcp` and a future GitHub Action reuse directly, plus the CLI's own
 * typed errors (K-48).
 *
 * @packageDocumentation
 */

export { rootCommand } from "./commands/root.js";
export type { DiscoveredConfig } from "./config/anchor.js";
export { resolveBundleRoot, resolveProjectRoot } from "./config/anchor.js";
export { buildConfigLayer, provideConfig } from "./config/layer.js";
export { ConfigMalformedError, ConfigPathNotFoundError, InitOverwriteError, renderFailure } from "./errors.js";
export type { ScaffoldFile, ScaffoldOptions } from "./init/scaffold.js";
export { CONFIG_RELATIVE_PATH, configValue, files, targetPaths } from "./init/scaffold.js";
export type { Tally } from "./render/exit.js";
export { forDiagnostics, tally } from "./render/exit.js";
export type { Counts } from "./render/human.js";
export { human, line, summary } from "./render/human.js";
export { JsonDiagnostic, JsonEnvelope, JsonErrorEnvelope, JsonSummary, json, jsonError } from "./render/json.js";
export type { DiagnosticSource, RenderedDiagnostic } from "./render/sort.js";
export { collect, sort } from "./render/sort.js";
export type { RunOptions, RunResult } from "./validate/run.js";
export { run } from "./validate/run.js";
export { CLI_VERSION } from "./version.js";
