/**
 * Model Context Protocol server for okfit: six read-only tools and the
 * bundle index plus one resource per concept, over an OKF bundle, spoken
 * over stdio.
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
	composeRemediatedMessage,
	truncateEchoed,
} from "./errors.js";
export { ConceptResources } from "./resources/conceptResource.js";
export { IndexResource } from "./resources/indexResource.js";
export { ConceptSummary, toConceptSummary } from "./schema/ConceptSummary.js";
export {
	ConceptNeighborsSuccess,
	DescribeVocabularySuccess,
	GetConceptSuccess,
	ListConceptsParams,
	ListConceptsSuccess,
	Neighbor,
	StaleReportParams,
	StaleReportSuccess,
	ValidateBundleParams,
} from "./schema/tools.js";
export type { PlatformServices } from "./server.js";
export { ServerLayer } from "./server.js";
export { OkfitToolkit, ToolsLayer } from "./toolkit.js";
export { MCP_VERSION } from "./version.js";
