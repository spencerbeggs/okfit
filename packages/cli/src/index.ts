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
	DiagnosticSource,
	DiscoveredConfig,
	RenderedDiagnostic,
	ResolveProjectConfigInput,
	ResolvedProjectConfig,
	RunOptions,
	RunResult,
	ScaffoldFile,
	ScaffoldOptions,
	Tally,
} from "@okfit/engine";
export {
	CONFIG_RELATIVE_PATH,
	ConfigMalformedError,
	ConfigPathNotFoundError,
	ContextEnvelope,
	ContextTag,
	ContextType,
	DEFAULT_PROFILE_NAME,
	InitOverwriteError,
	JsonDiagnostic,
	JsonEnvelope,
	JsonErrorEnvelope,
	JsonSummary,
	VerifyConceptNotFoundError,
	VerifyEnvelope,
	VerifyUnsupportedFrontmatterError,
	buildConfigLayer,
	collect,
	configValue,
	contextEnvelope,
	files,
	forDiagnostics,
	json,
	jsonError,
	provideConfig,
	resolveBundleRoot,
	resolveProjectConfig,
	resolveProjectRoot,
	run,
	runContext,
	sort,
	tally,
	targetPaths,
	verifyEnvelope,
} from "@okfit/engine";
export { rootCommand } from "./commands/root.js";
export { renderFailure } from "./errors.js";
export { humanContext } from "./render/context.js";
export type { Counts } from "./render/human.js";
export { human, line, summary } from "./render/human.js";
export type { VerifyLines } from "./render/verify.js";
export { humanVerify } from "./render/verify.js";
export { CLI_VERSION } from "./version.js";
