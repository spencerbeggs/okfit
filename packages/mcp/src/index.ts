/**
 * Model Context Protocol server for okfit: six read-only tools and two
 * resources over an OKF bundle, spoken over stdio.
 *
 * @packageDocumentation
 */

export {
	BundleNotFound,
	ConceptNotFound,
	ConfigError,
	InvalidArgument,
	McpToolError,
	Remediation,
	UnknownVocabulary,
} from "./errors.js";
export { resolveMcpProjectRoot } from "./internal/projectRoot.js";
export { resolveNow } from "./internal/resolveNow.js";
export type { ToolContext } from "./internal/toolContext.js";
export { loadToolContext, resolveConfigOnly } from "./internal/toolContext.js";
export { ConceptSummary, toConceptSummary } from "./schema/ConceptSummary.js";
export { DescribeVocabularySuccess } from "./schema/tools.js";
export type { PlatformServices } from "./server.js";
export { ServerLayer } from "./server.js";
export { OkfitToolkit, ToolsLayer } from "./toolkit.js";
export { MCP_VERSION } from "./version.js";
