import type { BundleLoadError, LinkGraph, LoadedBundle } from "@okfit/core";
import { Bundle, Graph } from "@okfit/core";
import type { FileSystem, Path } from "effect";
import { Effect } from "effect";

/** @public */
export interface GraphRunOptions {
	/** Absolute bundle root; `Bundle.load` never reads cwd (D-8). */
	readonly root: string;
}

/** @public */
export interface GraphRunResult {
	readonly bundle: LoadedBundle;
	readonly graph: LinkGraph;
}

/**
 * Load the bundle and build its link graph (D-6, D-26). Pure over the
 * loaded bundle once loading succeeds; `okfit graph` always exits `0`.
 *
 * @public
 */
export const runGraph = (
	options: GraphRunOptions,
): Effect.Effect<GraphRunResult, BundleLoadError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: options.root });
		const graph = Graph.fromBundle(bundle);
		return { bundle, graph };
	});
