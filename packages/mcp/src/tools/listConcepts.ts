import { ToolFailure, ToolRefusal } from "@effected/mcp";
import { AppDirs, Xdg } from "@effected/xdg";
import { ConceptQuery } from "@okfit/engine";
import { Effect, FileSystem, Path } from "effect";
import { Tool } from "effect/ai";
import { McpToolError } from "../errors.js";
import { loadToolContext } from "../internal/toolContext.js";
import { toConceptSummary } from "../schema/ConceptSummary.js";
import type { ListConceptsParams } from "../schema/tools.js";
import { ListConceptsSuccess, ListConceptsParams as Params } from "../schema/tools.js";

const DESCRIPTION =
	"Lists concept summaries from the okf bundle, optionally filtered by an exact type, by tags that must all be present (AND, not OR), and by status. Pages with limit (default 200, max 1000) and offset, and reports the total matching count. Use it to discover what exists before reading one concept with get_concept; an unknown type or tag name fails with the list of valid names.";

/**
 * `dependencies` mirrors `describe_vocabulary`'s (Deviation 1 in Task B1's
 * report): `loadToolContext` needs the same platform services
 * (`resolveConfigOnly` -> `resolveProjectConfig`/`provideConfig`, plus
 * `Bundle.load`), and without a `dependencies` declaration
 * `Tool.HandlerServices` infers `never`, failing the handler record against
 * `HandlersFrom` when it is passed to `OkfitToolkit.toLayer`.
 *
 * @public
 */
export const listConcepts = Tool.make("list_concepts", {
	description: DESCRIPTION,
	parameters: Params,
	success: ListConceptsSuccess,
	failure: McpToolError,
	dependencies: [FileSystem.FileSystem, Path.Path, AppDirs, Xdg],
})
	.annotate(Tool.Title, "List OKF concepts")
	.annotate(Tool.Readonly, true)
	.annotate(Tool.Idempotent, true)
	.annotate(Tool.OpenWorld, false);

/**
 * Deviation from the brief's literal snippet: `message` is composed through
 * `ToolFailure.message` (`@effected/mcp`), and the raw message embeds the
 * full `valid` list rather than leaving it only on the schema's `valid`
 * field — a declared typed failure under `failureMode: "error"` never
 * reaches the wire with `structuredContent` (B1's finding), so `valid`
 * would otherwise be unreachable to a real caller reading only
 * `content[0].text`.
 */
const unknown = (kind: "type" | "tag", requested: string, valid: ReadonlyArray<string>) => {
	const remediation = {
		hint: "Use one of the listed type names, or call describe_vocabulary.",
		suggestedTool: "describe_vocabulary",
	};
	const rawMessage = `"${ToolFailure.truncate(requested)}" is not a ${kind} declared by this project's okfit config. Valid ${kind}s: ${valid.join(", ")}.`;
	return ToolRefusal.refuse(rawMessage, remediation);
};

/** @public */
export const handleListConcepts = (projectRoot: string, params: ListConceptsParams) =>
	Effect.gen(function* () {
		const ctx = yield* loadToolContext(projectRoot);
		const filtered = yield* ConceptQuery.list(ctx.bundle, ctx.config, {
			...(params.type === undefined ? {} : { types: [params.type] }),
			...(params.tags === undefined ? {} : { tags: params.tags }),
			...(params.status === undefined ? {} : { statuses: [params.status] }),
		}).pipe(Effect.catchTag("QueryUnknownVocabularyError", (e) => Effect.fail(unknown(e.kind, e.requested, e.valid))));

		const limit = params.limit ?? 200;
		const offset = params.offset ?? 0;
		return {
			items: filtered.slice(offset, offset + limit).map(toConceptSummary),
			total: filtered.length,
		};
	});
