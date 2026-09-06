import type { AppDirs, Xdg } from "@effected/xdg";
import { Derive } from "@okfit/core";
import { Effect, FileSystem, Layer, Path } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { loadToolContext } from "../internal/toolContext.js";

/**
 * `okf://concept/<id>` — one static resource per concept in the bundle,
 * built once at server start.
 *
 * Amends N-19 and contract §6.1 (Ruling, task C4): a `McpServer.resource`
 * URI **template** routes a `McpSchema.param` through a single path
 * segment only — `FindMyWay`'s parametric matcher stops a param at the
 * next `/` (`.repos/effect/packages/effect/src/unstable/http/FindMyWay/internal/router.ts:355-360`),
 * and every non-root OKF concept id nests under a type directory (D-12),
 * e.g. `metrics/revenue`. A templated `okf://concept/{id}` therefore never
 * routes a real bundle id. Static per-concept resources sidestep the
 * router entirely: each concept gets its own literal `uri`, so there is
 * no segment-spanning to fail.
 *
 * The list is fixed at server start (`loadToolContext` runs once, inside
 * `Layer.unwrap`, not per read): a concept added after boot is not listed
 * until the server restarts, though editing an already-listed concept's
 * file is picked up live, since `content` re-reads the file from disk on
 * every read (same complete text `get_concept`'s `raw` field returns).
 *
 * If the bundle fails to load at boot (bad config, missing bundle root),
 * one line is logged and this layer contributes no resources — the
 * six tools stay usable; only `okf://index` remains, since it is
 * registered independently and re-resolves the bundle on every read.
 *
 * `content` builds the full `ReadResourceResult` itself, `mimeType`
 * included, rather than returning a bare string: verified against source
 * (`resolveResourceContent`, `unstable/ai/McpServer.ts:2324-2343`), a bare
 * string is wrapped as `{ contents: [{ uri, text }] }` with no `mimeType`
 * at all — the declared `mimeType` option only documents the resource in
 * `resources/list`, it is never merged into a `resources/read` response.
 *
 * @public
 */
export const ConceptResources = (
	projectRoot: string,
): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const ctx = yield* loadToolContext(projectRoot);
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const resourceLayers = [...ctx.bundle.concepts.entries()].map(([id, concept]) => {
				const uri = `okf://concept/${id}`;
				const absolutePath = path.join(ctx.bundleRoot, concept.path);
				return McpServer.resource({
					uri,
					name: id,
					description: Derive.title(concept),
					mimeType: "text/markdown",
					content: fs.readFileString(absolutePath).pipe(
						Effect.map((text) => ({ contents: [{ uri, mimeType: "text/markdown", text }] })),
						Effect.mapError(
							() => new McpSchema.InternalError({ message: `no readable concept file at ${absolutePath}` }),
						),
					),
				});
			});
			return resourceLayers.reduce(
				(acc, layer) => acc.pipe(Layer.merge(layer)),
				Layer.empty as Layer.Layer<never, never, never>,
			);
		}).pipe(
			Effect.tapError((error) =>
				Effect.logError(`okfit-mcp: could not load the bundle to register concept resources: ${error.message}`),
			),
			Effect.orElseSucceed(() => Layer.empty as Layer.Layer<never, never, never>),
		),
	);
