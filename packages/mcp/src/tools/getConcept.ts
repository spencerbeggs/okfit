import { AppDirs, Xdg } from "@effected/xdg";
import { Derive } from "@okfit/core";
import { ConceptQuery } from "@okfit/engine";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Tool } from "effect/ai";
import { McpToolError } from "../errors.js";
import { toConceptLookupFailure } from "../internal/conceptNotFound.js";
import { loadToolContext } from "../internal/toolContext.js";
import { GetConceptSuccess } from "../schema/tools.js";

const DESCRIPTION =
	"Returns one concept by id: its whole decoded frontmatter, the file's raw markdown text, its bundle-relative path, and every outgoing link with where the link was written and whether the target is another concept, an existing file, or missing. Accepts a tolerant id, with or without a leading slash or a trailing .md.";

/**
 * `dependencies` mirrors `list_concepts`' and `describe_vocabulary`'s
 * (Task B1's Deviation 1, carried through Task C1): `loadToolContext` needs
 * the same platform services, and without a `dependencies` declaration
 * `Tool.HandlerServices` infers `never`, failing the handler record against
 * `HandlersFrom` when it is passed to `OkfitToolkit.toLayer`.
 *
 * @public
 */
export const getConcept = Tool.make("get_concept", {
	description: DESCRIPTION,
	parameters: Schema.Struct({ id: Schema.String }),
	success: GetConceptSuccess,
	failure: McpToolError,
	dependencies: [FileSystem.FileSystem, Path.Path, AppDirs, Xdg],
})
	.annotate(Tool.Title, "Get one OKF concept")
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
export const handleGetConcept = (projectRoot: string, params: { readonly id: string }) =>
	Effect.gen(function* () {
		const ctx = yield* loadToolContext(projectRoot);
		const { concept, links } = yield* ConceptQuery.get(ctx.bundle, params.id).pipe(
			Effect.catchTag("QueryConceptNotFoundError", (e) => toConceptLookupFailure(params.id, e)),
		);

		return {
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
		};
	});
