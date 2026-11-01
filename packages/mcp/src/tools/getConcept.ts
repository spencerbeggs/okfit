import { ToolOutcome } from "@effected/mcp";
import { Derive } from "@okfit/core";
import { ConceptQuery, signalFor, toTrustDrift } from "@okfit/engine";
import { DateTime, Effect, Schema } from "effect";
import { Tool } from "effect/ai";
import { McpToolError } from "../errors.js";
import { conceptNotFound } from "../internal/conceptNotFound.js";
import { loadToolContext } from "../internal/toolContext.js";
import { toolSignals } from "../internal/toolSignals.js";
import { GetConceptSuccess } from "../schema/tools.js";

const DESCRIPTION =
	"Returns one concept by id: its decoded frontmatter, raw markdown, bundle-relative path, every outgoing link (with where it was written and whether the target is a concept, a file, or missing), and its okfit trust signal: tier, integrity, stale and drift. Accepts a tolerant id, with or without a leading slash or trailing .md.";

/**
 * No `dependencies`: since Effect 4.1 a declared dependency becomes a
 * per-request `McpRequest<"Requires", S>` requirement. The platform services
 * the handler needs are captured once when `ToolsLayer` builds instead
 * (`toolkit.ts`), so the handler's own requirement channel is `never`.
 *
 * @public
 */
export const getConcept = Tool.make("get_concept", {
	description: DESCRIPTION,
	parameters: Schema.Struct({ id: Schema.String }),
	success: GetConceptSuccess,
	failure: McpToolError,
})
	.annotate(Tool.Title, "Get one OKF concept")
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
export const handleGetConcept = (projectRoot: string, params: { readonly id: string }) =>
	Effect.gen(function* () {
		const ctx = yield* loadToolContext(projectRoot);
		const found = yield* ConceptQuery.get(ctx.bundle, params.id).pipe(
			ToolOutcome.catchAsEnvelope({ QueryConceptNotFoundError: (e) => conceptNotFound(params.id, e) }),
		);
		if (ToolOutcome.isFailure(found)) return found;
		const { concept, links } = found;

		const signals = yield* toolSignals(ctx.bundle, ctx.config, yield* DateTime.now);
		const signal = signalFor(signals, concept.id);

		return {
			ok: true as const,
			id: concept.id,
			type: concept.frontmatter.type,
			title: Derive.title(concept),
			description: concept.frontmatter.description ?? null,
			status: Derive.status(concept.frontmatter),
			tags: [...(concept.frontmatter.tags ?? [])],
			path: concept.path,
			frontmatter: concept.frontmatter.raw,
			raw: concept.document.source,
			links,
			tier: signal.tier,
			integrity: signal.integrity,
			stale: signal.stale,
			drift: toTrustDrift(signal),
		};
	});
