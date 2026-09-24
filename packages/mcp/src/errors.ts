import { Remediation } from "@effected/engine";
import { ToolFailure } from "@effected/mcp";
import { Schema } from "effect";

/**
 * What a caller should do next about a failed tool call. Re-exported from
 * `@effected/engine` -- the shape `ToolFailure.fields` (below) expects, in
 * place of the hand-rolled `{ hint, suggestedTool? }` struct this module
 * used to declare. @public
 */
export { Remediation };

// `ToolFailure.fields` (`@effected/mcp`) spreads `{ message: Schema.String,
// remediation: Remediation }` into every error below, replacing this
// module's own `composeRemediatedMessage`/`truncateEchoed`. Under
// `failureMode: "error"` (the only mode this contract's tools use),
// `McpServer`'s own `registerToolkit` collapses a caught typed failure to
// `{ isError: true, content: [{ type: "text", text: error.message }] }`
// and never surfaces `structuredContent` for it, so every constructor call
// site composes `message` through `ToolFailure.message(raw, remediation)`
// and truncates a caller-supplied value first through
// `ToolFailure.truncate(value, limit?)` -- both in the tool files that
// construct these errors, not here.

/**
 * Config discovery, parsing, or validation failed. @public
 */
export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
	...ToolFailure.fields,
}) {}

/**
 * The configured bundle root does not exist or could not be read. @public
 */
export class BundleNotFound extends Schema.TaggedError<BundleNotFound>()("BundleNotFound", {
	...ToolFailure.fields,
	root: Schema.String,
}) {}

/**
 * No concept in the bundle has the requested id. @public
 */
export class ConceptNotFound extends Schema.TaggedError<ConceptNotFound>()("ConceptNotFound", {
	...ToolFailure.fields,
	id: Schema.String,
}) {}

/**
 * A requested type or tag name is not declared in the resolved config.
 * @public
 */
export class UnknownVocabulary extends Schema.TaggedError<UnknownVocabulary>()("UnknownVocabulary", {
	...ToolFailure.fields,
	kind: Schema.Literals(["type", "tag"]),
	requested: Schema.String,
	valid: Schema.Array(Schema.String),
}) {}

/**
 * A tool argument was structurally acceptable but semantically invalid.
 * @public
 */
export class InvalidArgument extends Schema.TaggedError<InvalidArgument>()("InvalidArgument", {
	...ToolFailure.fields,
	argument: Schema.String,
}) {}

/** The one failure schema every tool declares (N-14). @public */
export const McpToolError = Schema.Union([
	ConfigError,
	BundleNotFound,
	ConceptNotFound,
	UnknownVocabulary,
	InvalidArgument,
]);
/** @public */
export type McpToolError = typeof McpToolError.Type;
