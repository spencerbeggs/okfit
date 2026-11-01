import { ToolOutcome } from "@effected/mcp";
import type { ConceptNeighbor } from "@okfit/engine";
import { ConceptQuery, signalFor } from "@okfit/engine";
import { DateTime, Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { McpToolError } from "../errors.js";
import { conceptNotFound } from "../internal/conceptNotFound.js";
import { loadToolContext } from "../internal/toolContext.js";
import { toolSignals } from "../internal/toolSignals.js";
import { toConceptSummary } from "../schema/ConceptSummary.js";
import { ConceptNeighborsSuccess } from "../schema/tools.js";

const DESCRIPTION =
	"Returns the graph neighbours of one concept: everything it links to (outgoing) and everything that links to it (incoming), each with the node kind and, for a concept target, its full summary. Use it after get_concept to walk the bundle's link graph one hop at a time without loading every concept.";

/**
 * No `dependencies`: since Effect 4.1 a declared dependency becomes a
 * per-request `McpRequest<"Requires", S>` requirement. The platform services
 * the handler needs are captured once when `ToolsLayer` builds instead
 * (`toolkit.ts`), so the handler's own requirement channel is `never`.
 *
 * @public
 */
export const conceptNeighbors = Tool.make("concept_neighbors", {
	description: DESCRIPTION,
	parameters: Schema.Struct({ id: Schema.String }),
	success: ConceptNeighborsSuccess,
	failure: McpToolError,
})
	.annotate(Tool.Title, "Concept graph neighbors")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * An unknown or empty id is an expected outcome, not a wrong call: it is
 * answered on the success channel as `ToolOutcome`'s `{ ok: false, error }`
 * envelope (`ConceptNotFound`), so the agent reads `_tag`, `reason` and the
 * remediation from `structuredContent`. Infrastructure failures (no config,
 * an unreadable bundle) stay declared `McpToolError` refusals.
 *
 * @public
 */
export const handleConceptNeighbors = (projectRoot: string, params: { readonly id: string }) =>
	Effect.gen(function* () {
		const ctx = yield* loadToolContext(projectRoot);
		const result = yield* ConceptQuery.neighbors(ctx.bundle, params.id).pipe(
			ToolOutcome.catchAsEnvelope({ QueryConceptNotFoundError: (e) => conceptNotFound(params.id, e) }),
		);
		if (ToolOutcome.isFailure(result)) return result;

		const signals = yield* toolSignals(ctx.bundle, ctx.config, yield* DateTime.now);

		const project = (neighbor: ConceptNeighbor) => ({
			id: neighbor.id,
			kind: neighbor.kind,
			summary:
				neighbor.concept === null ? null : toConceptSummary(neighbor.concept, signalFor(signals, neighbor.concept.id)),
		});

		return {
			ok: true as const,
			outgoing: result.outgoing.map(project),
			incoming: result.incoming.map(project),
		};
	});
