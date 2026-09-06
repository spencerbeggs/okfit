import { AppDirs, Xdg } from "@effected/xdg";
import type { ConceptId as ConceptIdType, GraphNodeKind } from "@okfit/core";
import { ConceptId, Graph } from "@okfit/core";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { Tool } from "effect/unstable/ai";
import { ConceptNotFound, InvalidArgument, McpToolError, composeRemediatedMessage } from "../errors.js";
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
 * {@link composeRemediatedMessage} at construction, since a declared typed
 * failure under `failureMode: "error"` never reaches the wire with
 * `structuredContent` — only `error.message` does.
 *
 * @public
 */
export const handleConceptNeighbors = (projectRoot: string, params: { readonly id: string }) =>
	Effect.gen(function* () {
		const ctx = yield* loadToolContext(projectRoot);
		const normalized = ConceptId.normalize(params.id);
		if (Option.isNone(normalized)) {
			const remediation = {
				hint: "Pass a bundle-relative concept id such as decisions/cli-exit-codes.",
				suggestedTool: "list_concepts",
			};
			return yield* Effect.fail(
				new InvalidArgument({
					argument: "id",
					message: composeRemediatedMessage("id must not be empty", remediation),
					remediation,
				}),
			);
		}
		const id = normalized.value;
		if (!ctx.bundle.concepts.has(id)) {
			const remediation = {
				hint: "Call list_concepts to see the ids this bundle contains.",
				suggestedTool: "list_concepts",
			};
			return yield* Effect.fail(
				new ConceptNotFound({
					id: params.id,
					message: composeRemediatedMessage(`no concept "${params.id}" in this bundle`, remediation),
					remediation,
				}),
			);
		}

		// Here successors/predecessors are correct, unlike in get_concept: this
		// tool reports unique neighbours only and needs no per-edge data (J-23).
		// The lookup above is repeated on purpose even though successors/
		// predecessors themselves return [] for an unknown id: an unknown id is
		// a caller mistake, and an empty result would hide it.
		const graph = Graph.fromBundle(ctx.bundle);
		const project = (node: { readonly id: string; readonly kind: GraphNodeKind }) => {
			if (node.kind !== "concept") return { id: node.id, kind: node.kind, summary: null };
			// A "concept"-kind node is by construction present in bundle.concepts
			// (Graph.fromBundle derives node kinds from the same lookup index).
			// The undefined branch below is the contract's own instruction to
			// emit summary: null rather than throw if that invariant is ever
			// violated (J-4).
			const concept = ctx.bundle.concepts.get(node.id as ConceptIdType);
			return {
				id: node.id,
				kind: node.kind,
				summary: concept === undefined ? null : toConceptSummary(concept),
			};
		};

		return {
			outgoing: graph.successors(id).map(project),
			incoming: graph.predecessors(id).map(project),
		};
	});
