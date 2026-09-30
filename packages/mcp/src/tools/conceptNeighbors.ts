import { AppDirs, Xdg } from "@effected/xdg";
import type { ConceptNeighbor } from "@okfit/engine";
import { ConceptQuery } from "@okfit/engine";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Tool } from "effect/ai";
import { McpToolError } from "../errors.js";
import { toConceptLookupFailure } from "../internal/conceptNotFound.js";
import { loadToolContext } from "../internal/toolContext.js";
import { toConceptSummary } from "../schema/ConceptSummary.js";
import { ConceptNeighborsSuccess } from "../schema/tools.js";

const DESCRIPTION =
	"Returns the graph neighbours of one concept: everything it links to (outgoing) and everything that links to it (incoming), each with the node kind and, for a concept target, its full summary. Use it after get_concept to walk the bundle's link graph one hop at a time without loading every concept.";

/**
 * `dependencies` mirrors the other tools' (Task B1's Deviation 1): without it
 * `Tool.HandlerServices` infers `never`, failing the handler record against
 * `HandlersFrom` when passed to `OkfitToolkit.toLayer`.
 *
 * @public
 */
export const conceptNeighbors = Tool.make("concept_neighbors", {
	description: DESCRIPTION,
	parameters: Schema.Struct({ id: Schema.String }),
	success: ConceptNeighborsSuccess,
	failure: McpToolError,
	dependencies: [FileSystem.FileSystem, Path.Path, AppDirs, Xdg],
})
	.annotate(Tool.Title, "Concept graph neighbors")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * Deviation from the brief's literal snippet, matching the ruling binding
 * every C task (progress.md): `message` is composed through
 * `ToolFailure.message` (`@effected/mcp`) at construction, since a declared
 * typed failure under `failureMode: "error"` never reaches the wire with
 * `structuredContent` — only `error.message` does.
 *
 * @public
 */
export const handleConceptNeighbors = (projectRoot: string, params: { readonly id: string }) =>
	Effect.gen(function* () {
		const ctx = yield* loadToolContext(projectRoot);
		const result = yield* ConceptQuery.neighbors(ctx.bundle, params.id).pipe(
			Effect.catchTag("QueryConceptNotFoundError", (e) => toConceptLookupFailure(params.id, e)),
		);

		const project = (neighbor: ConceptNeighbor) => ({
			id: neighbor.id,
			kind: neighbor.kind,
			summary: neighbor.concept === null ? null : toConceptSummary(neighbor.concept),
		});

		return {
			outgoing: result.outgoing.map(project),
			incoming: result.incoming.map(project),
		};
	});
