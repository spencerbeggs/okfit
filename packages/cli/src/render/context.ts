import type { ContextEnvelope } from "@okfit/engine";

/**
 * The `human` format: a short header block, then one line per type and one
 * per tag. Pure; the caller pipes each line through `Console.log`.
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
	...envelope.types.map((t) => `  ${t.name}  ${t.description ?? ""}`),
	"",
	"tags:",
	...envelope.tags.map((t) => `  ${t.name}  ${t.description ?? ""}`),
];
