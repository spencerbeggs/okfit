import { ErrorText } from "@effected/kit";
import { SchemaIssue } from "effect";

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** `["bundle", "non_concepts", 1]` reads `bundle.non_concepts[1]`. */
const keyOf = (path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined): string => {
	let key = "";
	for (const segment of path ?? []) {
		const part = typeof segment === "object" ? segment.key : segment;
		key += typeof part === "number" ? `[${part}]` : key === "" ? String(part) : `.${String(part)}`;
	}
	return key;
};

/**
 * The text that follows `malformed config <path>: ` (D8). A `ConfigValidationError` carrying a
 * schema `issue` reads `<key>: <reason>`, one entry per issue joined with `; `, and a path-less
 * issue drops the `<key>: ` part; any other cause keeps `ErrorText.describe(cause)`. Detected by
 * `_tag` so this module takes no value import from `@effected/config-file`.
 *
 * @internal
 */
export const describeConfigCause = (cause: unknown): string => {
	if (typeof cause === "object" && cause !== null && "_tag" in cause && cause._tag === "ConfigValidationError") {
		const issue = "issue" in cause ? cause.issue : undefined;
		if (SchemaIssue.isIssue(issue)) {
			const entries = formatIssues(issue).issues.map((entry) => {
				const key = keyOf(entry.path);
				return key === "" ? entry.message : `${key}: ${entry.message}`;
			});
			if (entries.length > 0) return entries.join("; ");
		}
	}
	return ErrorText.describe(cause);
};
