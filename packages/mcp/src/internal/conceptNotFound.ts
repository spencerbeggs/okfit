import { ToolFailure } from "@effected/mcp";
import type { QueryConceptNotFoundError } from "@okfit/engine";
import { Effect } from "effect";
import { ConceptNotFound, InvalidArgument } from "../errors.js";

/**
 * Maps the engine's `QueryConceptNotFoundError` to the tool-facing failure
 * `get_concept` and `concept_neighbors` share: `InvalidArgument` for an empty
 * id, `ConceptNotFound` otherwise. `message` is composed through
 * `ToolFailure.message` at construction, since a declared typed failure under
 * `failureMode: "error"` reaches the wire as `error.message` alone.
 *
 * @internal
 */
export const toConceptLookupFailure = (
	id: string,
	error: QueryConceptNotFoundError,
): Effect.Effect<never, InvalidArgument | ConceptNotFound> => {
	if (error.reason === "empty-id") {
		const remediation = {
			hint: "Pass a bundle-relative concept id such as decisions/cli-exit-codes.",
			suggestedTool: "list_concepts",
		};
		return Effect.fail(
			new InvalidArgument({
				argument: "id",
				message: ToolFailure.message("id must not be empty", remediation),
				remediation,
			}),
		);
	}
	const remediation = {
		hint: "Call list_concepts to see the ids this bundle contains.",
		suggestedTool: "list_concepts",
	};
	return Effect.fail(
		new ConceptNotFound({
			id,
			message: ToolFailure.message(`no concept "${ToolFailure.truncate(id)}" in this bundle`, remediation),
			remediation,
		}),
	);
};
