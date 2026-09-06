import { Schema } from "effect";

/** What a caller should do next about a failed tool call. @public */
export const Remediation = Schema.Struct({
	hint: Schema.String,
	suggestedTool: Schema.optionalKey(Schema.String),
});

/** Config discovery, parsing, or validation failed. @public */
export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
	message: Schema.String,
	remediation: Remediation,
}) {}

/** The configured bundle root does not exist or could not be read. @public */
export class BundleNotFound extends Schema.TaggedError<BundleNotFound>()("BundleNotFound", {
	root: Schema.String,
	message: Schema.String,
	remediation: Remediation,
}) {}

/** No concept in the bundle has the requested id. @public */
export class ConceptNotFound extends Schema.TaggedError<ConceptNotFound>()("ConceptNotFound", {
	id: Schema.String,
	message: Schema.String,
	remediation: Remediation,
}) {}

/** A requested type or tag name is not declared in the resolved config. @public */
export class UnknownVocabulary extends Schema.TaggedError<UnknownVocabulary>()("UnknownVocabulary", {
	kind: Schema.Literals(["type", "tag"]),
	requested: Schema.String,
	valid: Schema.Array(Schema.String),
	message: Schema.String,
	remediation: Remediation,
}) {}

/** A tool argument was structurally acceptable but semantically invalid. @public */
export class InvalidArgument extends Schema.TaggedError<InvalidArgument>()("InvalidArgument", {
	argument: Schema.String,
	message: Schema.String,
	remediation: Remediation,
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
