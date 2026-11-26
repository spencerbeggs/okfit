import type { AppDirs, Xdg } from "@effected/xdg";
import { Derive } from "@okfit/core";
import type { FileSystem } from "effect";
import { Effect, Layer, Path } from "effect";
import { McpServer } from "effect/ai";
import { readResourceText } from "../internal/confinedText.js";
import { loadToolContext } from "../internal/toolContext.js";

/**
 * `okf://concept/<id>` — one static resource per concept in the bundle,
 * built once at server start.
 *
 * Amends N-19 and contract §6.1 (Ruling, task C4): a `McpServer.resource`
 * URI **template** routes a `McpSchema.param` through a single path
 * segment only — `FindMyWay`'s parametric matcher stops a param at the
 * next `/` (`.repos/effect/packages/effect/src/http/FindMyWay/internal/router.ts:460-463`),
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
 * Each read is confined at the moment of reading (OKF 0.3 section 3.2),
 * through core's `readConfinedString`: the file is opened, its path
 * resolved and the open file's `dev` and `ino` compared with the resolved
 * path's, so a file, or a directory above it, that links out of the bundle
 * (or dangles) is refused with `<path> links out of the bundle`. A link at
 * the file itself is refused even when it is swapped in during the read; a
 * race through a directory above the file can still win
 * (spencerbeggs/okfit#524). A file replaced under the read is answered
 * `"<path>" changed while it was read; try again`, never labelled a link; a
 * removed one answers `no readable concept file at <path>`. A
 * link that stays inside the bundle, and a hard link to a file under the
 * root, are served.
 *
 * If the bundle fails to load at boot (bad config, missing bundle root),
 * one line is logged and this layer contributes no resources — the
 * six tools stay usable; only `okf://index` remains, since it is
 * registered independently and re-resolves the bundle on every read.
 *
 * `content` builds the full `ReadResourceResult` itself, `mimeType`
 * included, rather than returning a bare string: verified against source
 * (`resolveResourceContent`, `ai/McpServer.ts:2556-2576`), a bare
 * string is wrapped as `{ contents: [{ uri, text }] }` with no `mimeType`
 * at all — the declared `mimeType` option only documents the resource in
 * `resources/list`, it is never merged into a `resources/read` response.
 *
 * @public
 */
export const ConceptResources = (
	projectRoot: string,
): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg | McpServer.McpServer> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const ctx = yield* loadToolContext(projectRoot);
			const path = yield* Path.Path;
			const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
			const resourceLayers = [...ctx.bundle.concepts.entries()].map(([id, concept]) => {
				const uri = `okf://concept/${id}`;
				const absolutePath = path.join(ctx.bundleRoot, concept.path);
				return McpServer.resource({
					uri,
					name: id,
					description: Derive.title(concept),
					mimeType: "text/markdown",
					content: Effect.gen(function* () {
						// Opened, resolved and identity-compared in one step (OKF 0.3 section 3.2), so a file, or a directory
						// above it, swapped for a link out of the bundle at any moment is refused, never read.
						const text = yield* readResourceText(
							ctx.bundleRoot,
							absolutePath,
							concept.path,
							`no readable concept file at ${concept.path}`,
						);
						return { contents: [{ uri, mimeType: "text/markdown", text }] };
					}).pipe(Effect.provide(services)),
				});
			});
			return resourceLayers.reduce(
				(acc, layer) => acc.pipe(Layer.merge(layer)),
				Layer.empty as Layer.Layer<never, never, McpServer.McpServer>,
			);
		}).pipe(
			Effect.tapError((error) =>
				Effect.logError(`okfit-mcp: could not load the bundle to register concept resources: ${error.message}`),
			),
			Effect.orElseSucceed(() => Layer.empty as Layer.Layer<never, never, never>),
		),
	);
