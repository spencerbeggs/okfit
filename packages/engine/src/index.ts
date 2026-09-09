/**
 * The okfit engine: the platform layer, config discovery, and the
 * validate, verify, sync, init and context programs shared by the okfit
 * CLI and the okfit MCP server.
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
export { OKFIT_APP_NAMESPACE, OkfitPlatform } from "./platform.js";
export type { RunOptions, RunResult } from "./validate/run.js";
export { Now, run } from "./validate/run.js";
