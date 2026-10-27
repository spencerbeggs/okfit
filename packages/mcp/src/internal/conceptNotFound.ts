import { ToolFailure } from "@effected/mcp";
import type { QueryConceptNotFoundError } from "@okfit/engine";

/**
 * The `ConceptNotFound` envelope error `get_concept` and `concept_neighbors`
 * share, for `ToolOutcome.catchAsEnvelope`: the engine's `id` and `reason`,
 * a message saying the id is empty or that no concept has it, and a
 * remediation pointing at `list_concepts`. An unknown id is an expected
 * outcome the agent branches on, not a wrong call, so it rides the success
 * channel (`isError: false`, `structuredContent.ok: false`).
 *
 * @internal
 */
export const conceptNotFound = (requested: string, error: QueryConceptNotFoundError) =>
	error.reason === "empty-id"
		? {
				id: error.id,
				reason: error.reason,
				message: "id must not be empty",
				remediation: {
					hint: "Pass a bundle-relative concept id such as decisions/cli-exit-codes.",
					suggestedTool: "list_concepts",
				},
			}
		: {
				id: error.id,
				reason: error.reason,
				message: `no concept "${ToolFailure.truncate(requested)}" in this bundle`,
				remediation: {
					hint: "Call list_concepts to see the ids this bundle contains.",
					suggestedTool: "list_concepts",
				},
			};
