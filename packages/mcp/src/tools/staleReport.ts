import { Derive } from "@okfit/core";
import { signalFor, toTrustDrift } from "@okfit/engine";
import { DateTime, Effect } from "effect";
import { Tool } from "effect/ai";
import { McpToolError } from "../errors.js";
import { resolveNow } from "../internal/resolveNow.js";
import { loadToolContext } from "../internal/toolContext.js";
import { toolSignals } from "../internal/toolSignals.js";
import { toConceptSummary } from "../schema/ConceptSummary.js";
import type { StaleReportParams } from "../schema/tools.js";
import { StaleReportParams as Params, StaleReportSuccess } from "../schema/tools.js";

const DESCRIPTION =
	"Lists every stale or drifted concept. items: stale_after passed, each with its summary, the date and whole days past. drifted: human-verified concepts whose content changed since (or was never bound), with the reason and last editor. Uses the current time unless now is given (ISO-8601 with an explicit offset).";

/**
 * No `dependencies`: since Effect 4.1 a declared dependency becomes a
 * per-request `McpRequest<"Requires", S>` requirement. The platform services
 * the handler needs are captured once when `ToolsLayer` builds instead
 * (`toolkit.ts`), so the handler's own requirement channel is `never`.
 *
 * @public
 */
export const staleReport = Tool.make("stale_report", {
	description: DESCRIPTION,
	parameters: Params,
	success: StaleReportSuccess,
	failure: McpToolError,
})
	.annotate(Tool.Title, "Stale concepts")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/** @public */
export const handleStaleReport = (projectRoot: string, params: StaleReportParams) =>
	Effect.gen(function* () {
		const ctx = yield* loadToolContext(projectRoot);
		const now = yield* resolveNow(params.now);
		const signals = yield* toolSignals(ctx.bundle, ctx.config, now);
		const items = Derive.staleReport(ctx.bundle, now).flatMap((entry) => {
			const concept = ctx.bundle.concepts.get(entry.id);
			return concept === undefined
				? []
				: [
						{
							summary: toConceptSummary(concept, signalFor(signals, concept.id)),
							stale_after: DateTime.formatIso(entry.staleAfter),
							days_past: entry.daysPast,
						},
					];
		});
		const drifted = [...ctx.bundle.concepts.values()].flatMap((concept) => {
			const signal = signalFor(signals, concept.id);
			const drift = toTrustDrift(signal);
			return drift === null
				? []
				: [
						{
							summary: toConceptSummary(concept, signal),
							reason: drift.reason,
							edited_by: drift.edited_by,
							edited_at: drift.edited_at,
						},
					];
		});
		return { as_of: DateTime.formatIso(now), items, drifted };
	});
