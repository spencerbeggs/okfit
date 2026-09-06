import { AppDirs, Xdg } from "@effected/xdg";
import { Derive } from "@okfit/core";
import { DateTime, Effect, FileSystem, Path } from "effect";
import { Tool } from "effect/unstable/ai";
import { McpToolError } from "../errors.js";
import { resolveNow } from "../internal/resolveNow.js";
import { loadToolContext } from "../internal/toolContext.js";
import { toConceptSummary } from "../schema/ConceptSummary.js";
import type { StaleReportParams } from "../schema/tools.js";
import { StaleReportParams as Params, StaleReportSuccess } from "../schema/tools.js";

const DESCRIPTION =
	"Lists every concept whose stale_after instant has passed, each with its summary, the date, and how many whole days past it. Uses the current time by default; pass now as an ISO-8601 instant with an explicit offset to report staleness as of a different moment.";

/**
 * `dependencies` mirrors the other tools' (Task B1's Deviation 1):
 * `loadToolContext` needs the same platform services, and without a
 * `dependencies` declaration `Tool.HandlerServices` infers `never`, failing
 * the handler record against `HandlersFrom` when passed to
 * `OkfitToolkit.toLayer`.
 *
 * @public
 */
export const staleReport = Tool.make("stale_report", {
	description: DESCRIPTION,
	parameters: Params,
	success: StaleReportSuccess,
	failure: McpToolError,
	dependencies: [FileSystem.FileSystem, Path.Path, AppDirs, Xdg],
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
		const items = Derive.staleReport(ctx.bundle, now).flatMap((entry) => {
			const concept = ctx.bundle.concepts.get(entry.id);
			return concept === undefined
				? []
				: [
						{
							summary: toConceptSummary(concept),
							stale_after: DateTime.formatIso(entry.staleAfter),
							days_past: entry.daysPast,
						},
					];
		});
		return { as_of: DateTime.formatIso(now), items };
	});
