import type { BundleLoadError, LoadedBundle, StaleConcept } from "@okfit/core";
import { Bundle, Derive } from "@okfit/core";
import type { DateTime, FileSystem, Path } from "effect";
import { Effect } from "effect";

/** @public */
export interface StaleRunOptions {
	/** Absolute bundle root; `Bundle.load` never reads cwd (D-8). */
	readonly root: string;
	/** `OKFIT_NOW` or `DateTime.now`, from the caller's own `Now` service (K-47). */
	readonly now: DateTime.Utc;
}

/** @public */
export interface StaleRunResult {
	readonly bundle: LoadedBundle;
	/** `Derive.staleReport`'s output verbatim: every stale concept, sorted by id. */
	readonly items: ReadonlyArray<StaleConcept>;
}

/**
 * Load the bundle and derive the stale report against `now` (D-10, D-36:
 * `Derive.staleReport` is pure and takes `now` as an argument, never a
 * clock). This is a report, not a check — `okfit stale` always exits `0`;
 * the `stale` lint rule is where staleness fails a run.
 *
 * @public
 */
export const runStale = (
	options: StaleRunOptions,
): Effect.Effect<StaleRunResult, BundleLoadError, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: options.root });
		const items = Derive.staleReport(bundle, options.now);
		return { bundle, items };
	});
