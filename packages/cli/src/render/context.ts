import type { ContextEnvelope, ContextType } from "@okfit/engine";

/** `kind (a | b)` for an enum field, `resource (path)` for a path field, bare `layer` for free text. */
const renderField = (field: ContextType["fields"][number]): string =>
	field.values !== null
		? `${field.name} (${field.values.map((v) => v.name).join(" | ")})`
		: field.kind !== null
			? `${field.name} (${field.kind})`
			: field.name;

/**
 * The constraint lines under one type bullet (issue #33): what `validate`
 * will require of a concept of this type, so an agent learns it here and
 * not from a lint error. Empty for a type that declares none.
 */
const constraintLines = (type: ContextType): ReadonlyArray<string> => [
	...(type.required !== null && type.required.length > 0 ? [`    required: ${type.required.join(", ")}`] : []),
	...(type.require_verified === true ? ["    verified: required"] : []),
	...(type.fields.length > 0 ? [`    fields: ${type.fields.map(renderField).join(", ")}`] : []),
];

/**
 * The `human` format: a short header block, then one line per type (plus
 * its constraint lines, when it has any) and one per tag. Pure; the caller
 * pipes each line through `Console.log`.
 *
 * The `profile:` line reads `profile: (none) (requested NAME, unknown)`
 * when `profile` and `profile_requested` disagree over an actually-unknown
 * profile — never for the `"none"` or no-config cases, where a `null`
 * `profile` is expected, not an error.
 *
 * @public
 */
export const humanContext = (envelope: ContextEnvelope): ReadonlyArray<string> => [
	`project root: ${envelope.project_root}`,
	`bundle root: ${envelope.bundle_root}`,
	`config: ${envelope.config_path ?? "(none)"}`,
	envelope.profile === null && envelope.profile_requested !== null && envelope.profile_requested !== "none"
		? `profile: (none) (requested ${envelope.profile_requested}, unknown)`
		: `profile: ${envelope.profile ?? "(none)"}`,
	`index.md: ${envelope.index_path} (${envelope.index_exists ? "exists" : "missing"})`,
	`agent: ${envelope.actors.agent ?? "(unset)"}`,
	"",
	"types:",
	...envelope.types.flatMap((t) => [`  ${t.name}  ${t.description ?? ""}`, ...constraintLines(t)]),
	"",
	"tags:",
	...envelope.tags.map((t) => `  ${t.name}  ${t.description ?? ""}`),
];
