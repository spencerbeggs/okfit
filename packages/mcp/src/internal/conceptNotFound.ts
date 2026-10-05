import { ToolFailure, ToolRefusal } from "@effected/mcp";
import type { QueryConceptNotFoundError } from "@okfit/engine";
import { Effect } from "effect";

/**
 * Maps the engine's `QueryConceptNotFoundError` to the tool-facing failure
 * `get_concept` and `concept_neighbors` share: a `ToolRefusal` saying the id
 * is empty, or that no concept has it. `ToolRefusal.refuse` folds the
 * remediation into the message, which is all a declared failure sends.
 *
 * @internal
 */
export const toConceptLookupFailure = (
	id: string,
	error: QueryConceptNotFoundError,
): Effect.Effect<never, ToolRefusal> => {
	if (error.reason === "empty-id") {
		const remediation = {
			hint: "Pass a bundle-relative concept id such as decisions/cli-exit-codes.",
			suggestedTool: "list_concepts",
		};
		return Effect.fail(ToolRefusal.refuse("id must not be empty", remediation));
	}
	const remediation = {
		hint: "Call list_concepts to see the ids this bundle contains.",
		suggestedTool: "list_concepts",
	};
	return Effect.fail(ToolRefusal.refuse(`no concept "${ToolFailure.truncate(id)}" in this bundle`, remediation));
};
