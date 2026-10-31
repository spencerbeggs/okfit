import type { Git } from "@effected/git";
import type { AppDirs, Xdg } from "@effected/xdg";
import type { Distribution } from "@okfit/engine";
import type { GitHistory } from "@okfit/profiles";
import type { FileSystem, Path } from "effect";
import { Effect } from "effect";
import { Toolkit } from "effect/ai";
import type { Digest } from "effect/crypto";
import { conceptNeighbors, handleConceptNeighbors } from "./tools/conceptNeighbors.js";
import { describeVocabulary, handleDescribeVocabulary } from "./tools/describeVocabulary.js";
import { getConcept, handleGetConcept } from "./tools/getConcept.js";
import { handleListConcepts, listConcepts } from "./tools/listConcepts.js";
import { handleStaleReport, staleReport } from "./tools/staleReport.js";
import { handleValidateBundle, validateBundle } from "./tools/validateBundle.js";

/**
 * The six read-only tools (N-10). Tasks C1, C2 and C3 each add two; the
 * order here is the tool set's own order and is what
 * `agents/okf-docs.md`'s `tools:` allowlist mirrors.
 *
 * @public
 */
export const OkfitToolkit = Toolkit.make(
	describeVocabulary,
	listConcepts,
	getConcept,
	conceptNeighbors,
	staleReport,
	validateBundle,
);

/**
 * The platform services the six handlers run on: config and bundle loading
 * (`FileSystem`, `Path`, `AppDirs`, `Xdg`), the body and content digests
 * (`Digest`), and `validate_bundle`'s `generated-at-drift` lint (`Git`,
 * `GitHistory`).
 *
 * @public
 */
export type ToolServices = FileSystem.FileSystem | Path.Path | AppDirs | Xdg | Digest.Digest | Git | GitHistory;

/**
 * The handler layer. `projectRoot` is closed over from the bin (N-21);
 * the bundle itself reloads on every call inside each handler (N-9).
 * `distribution` (okfit #137) is whatever `ServerLayer` was given -- only
 * `validate_bundle` renders a `JsonEnvelope`, so it is the only handler
 * that needs it.
 *
 * The {@link ToolServices} are captured once, when this layer builds, and
 * provided to every call. Since Effect 4.1 a tool's declared `dependencies`
 * become per-request `McpRequest<"Requires", S>` requirements, which a
 * plain `Layer.provide` no longer meets; these services are fixed for the
 * server's lifetime, so the build-time capture is the shape that fits.
 *
 * @public
 */
export const ToolsLayer = (projectRoot: string, distribution?: Distribution) =>
	OkfitToolkit.toLayer(
		Effect.gen(function* () {
			const services = yield* Effect.context<ToolServices>();
			const provide = <A, E>(effect: Effect.Effect<A, E, ToolServices>): Effect.Effect<A, E> =>
				Effect.provide(effect, services);
			return {
				describe_vocabulary: () => provide(handleDescribeVocabulary(projectRoot)),
				list_concepts: (params) => provide(handleListConcepts(projectRoot, params)),
				get_concept: (params) => provide(handleGetConcept(projectRoot, params)),
				concept_neighbors: (params) => provide(handleConceptNeighbors(projectRoot, params)),
				stale_report: (params) => provide(handleStaleReport(projectRoot, params)),
				validate_bundle: (params) => provide(handleValidateBundle(projectRoot, params, distribution)),
			};
		}),
	);
