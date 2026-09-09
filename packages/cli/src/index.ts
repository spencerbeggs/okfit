/**
 * Programmatic surface of the okfit command line: the pure pieces
 * `@okfit/mcp` and a future GitHub Action reuse directly, plus the CLI's own
 * typed errors (K-48).
 *
 * @packageDocumentation
 */

export type { ConfigReadError } from "@effected/config-file";
export type {
	ContextResult,
	ContextRunOptions,
	DiscoveredConfig,
	ResolveProjectConfigInput,
	ResolvedProjectConfig,
	RunOptions,
	RunResult,
	ScaffoldFile,
	ScaffoldOptions,
} from "@okfit/engine";
export {
	CONFIG_RELATIVE_PATH,
	ConfigMalformedError,
	ConfigPathNotFoundError,
	DEFAULT_PROFILE_NAME,
	InitOverwriteError,
	VerifyConceptNotFoundError,
	VerifyUnsupportedFrontmatterError,
	buildConfigLayer,
	configValue,
	files,
	provideConfig,
	resolveBundleRoot,
	resolveProjectConfig,
	resolveProjectRoot,
	run,
	runContext,
	targetPaths,
} from "@okfit/engine";
export { rootCommand } from "./commands/root.js";
export { renderFailure } from "./errors.js";
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
export { CLI_VERSION } from "./version.js";
