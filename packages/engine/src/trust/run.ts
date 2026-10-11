import type { BundleLoadError } from "@okfit/core";
import { Bundle } from "@okfit/core";
import { Trust } from "@okfit/profiles";
import type { Crypto, DateTime, FileSystem, Path, PlatformError } from "effect";
import { Effect } from "effect";
import type { ContextTrust } from "../render/context.js";

/** @public */
export interface ContextTrustOptions {
	readonly bundleRoot: string;
	/** `OKFIT_NOW` or `DateTime.now`, from the caller's own `Now` service. */
	readonly now: DateTime.Utc;
}

const FIRST = 5;

/**
 * The opt-in half of `context`: load the bundle and fold {@link Trust.signals}
 * into counts plus the first five drifted and stale ids. Kept apart from
 * {@link runContext} so the default path never loads the bundle; only
 * `--trust` pays for it. Hashing happens inside `Trust.signals`, and only
 * for concepts a human verification binds.
 *
 * @public
 */
export const runContextTrust = (
	options: ContextTrustOptions,
): Effect.Effect<
	ContextTrust,
	BundleLoadError | PlatformError.PlatformError,
	FileSystem.FileSystem | Path.Path | Crypto.Crypto
> =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: options.bundleRoot });
		const signals = yield* Trust.signals(bundle, options.now);
		const entries = [...signals.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		const driftedIds = entries.filter(([, s]) => s.integrity === "drifted").map(([id]) => id);
		const staleIds = entries.filter(([, s]) => s.stale).map(([id]) => id);
		return {
			concepts: entries.length,
			drifted: driftedIds.length,
			stale: staleIds.length,
			unverified: entries.filter(([, s]) => s.tier === "unverified").length,
			drifted_ids: driftedIds.slice(0, FIRST),
			stale_ids: staleIds.slice(0, FIRST),
		};
	});
