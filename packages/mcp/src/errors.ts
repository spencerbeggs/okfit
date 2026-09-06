import { Schema } from "effect";

/** What a caller should do next about a failed tool call. @public */
export const Remediation = Schema.Struct({
	hint: Schema.String,
	suggestedTool: Schema.optionalKey(Schema.String),
});
/** @public */
export type Remediation = typeof Remediation.Type;

/**
 * Compose a self-contained wire message from a raw cause message and its
 * remediation: the human message, then the hint, then `Try <suggestedTool>.`
 * when one is present. Every `McpToolError` member's `message` field is
 * built through this at construction — under `failureMode: "error"` (the
 * only mode this contract's tools use), `McpServer`'s own `registerToolkit`
 * collapses a caught typed failure to
 * `{ isError: true, content: [{ type: "text", text: error.message }] }`
 * and never surfaces `structuredContent` for it
 * (`.repos/effect/packages/effect/src/unstable/ai/McpServer.ts:1502-1506,1576-1584`,
 * confirmed empirically in Task B1's own build). `remediation` itself is
 * left on the schema unchanged, both for anything that inspects the typed
 * error directly (a defect handler, a future in-process caller) and
 * because it is what this function reads to build `message`.
 *
 * @public
 */
export const composeRemediatedMessage = (message: string, remediation: Remediation): string =>
	remediation.suggestedTool === undefined
		? `${message} ${remediation.hint}`
		: `${message} ${remediation.hint} Try ${remediation.suggestedTool}.`;

/**
 * Config discovery, parsing, or validation failed. `message` is composed
 * through {@link composeRemediatedMessage} at construction, so it is what
 * reaches the wire as `tools/call`'s `content[0].text` (see that
 * function's doc comment for why). @public
 */
export class ConfigError extends Schema.TaggedError<ConfigError>()("ConfigError", {
	message: Schema.String,
	remediation: Remediation,
}) {}

/**
 * The configured bundle root does not exist or could not be read.
 * `message` is composed through {@link composeRemediatedMessage} at
 * construction, so it is what reaches the wire as `tools/call`'s
 * `content[0].text`. @public
 */
export class BundleNotFound extends Schema.TaggedError<BundleNotFound>()("BundleNotFound", {
	root: Schema.String,
	message: Schema.String,
	remediation: Remediation,
}) {}

/**
 * No concept in the bundle has the requested id. `message` is composed
 * through {@link composeRemediatedMessage} at construction, so it is what
 * reaches the wire as `tools/call`'s `content[0].text`. @public
 */
export class ConceptNotFound extends Schema.TaggedError<ConceptNotFound>()("ConceptNotFound", {
	id: Schema.String,
	message: Schema.String,
	remediation: Remediation,
}) {}

/**
 * A requested type or tag name is not declared in the resolved config.
 * `message` is composed through {@link composeRemediatedMessage} at
 * construction, so it is what reaches the wire as `tools/call`'s
 * `content[0].text`. @public
 */
export class UnknownVocabulary extends Schema.TaggedError<UnknownVocabulary>()("UnknownVocabulary", {
	kind: Schema.Literals(["type", "tag"]),
	requested: Schema.String,
	valid: Schema.Array(Schema.String),
	message: Schema.String,
	remediation: Remediation,
}) {}

/**
 * A tool argument was structurally acceptable but semantically invalid.
 * `message` is composed through {@link composeRemediatedMessage} at
 * construction, so it is what reaches the wire as `tools/call`'s
 * `content[0].text`. @public
 */
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
