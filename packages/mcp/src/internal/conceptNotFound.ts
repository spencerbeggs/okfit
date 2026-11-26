import { ToolFailure } from "@effected/mcp-kit";
import type { QueryConceptNotFoundError } from "@okfit/engine";

/**
 * The `ConceptNotFound` envelope error `get_concept` and `concept_neighbors`
 * share, for `ToolOutcome.catchAsEnvelope`: the engine's `id` and `reason`,
 * a message saying the id is empty, that no concept has it, or that the
 * concept changed while the bundle was read (transient: call again), and a
 * remediation. An unknown id is an expected outcome the agent branches on,
 * not a wrong call, so it rides the success channel (`isError: false`,
 * `structuredContent.ok: false`).
 *
 * @internal
 */
export const conceptNotFound = (requested: string, error: QueryConceptNotFoundError) => {
	if (error.reason === "changed-during-read") {
		return {
			id: error.id,
			reason: error.reason,
			message: `${ToolFailure.truncate(error.id)}.md changed while it was read; try again`,
			remediation: { hint: "The file changed under the read, usually an editor save. Call the tool again." },
		};
	}
	if (error.reason === "empty-id") {
		return {
			id: error.id,
			reason: error.reason,
			message: "id must not be empty",
			remediation: {
				hint: "Pass a bundle-relative concept id such as decisions/cli-exit-codes.",
				suggestedTool: "list_concepts",
			},
		};
	}
	return {
		id: error.id,
		reason: error.reason,
		message: `no concept "${ToolFailure.truncate(requested)}" in this bundle`,
		remediation: {
			hint: "Call list_concepts to see the ids this bundle contains.",
			suggestedTool: "list_concepts",
		},
	};
};
