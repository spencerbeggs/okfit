import { Doc } from "@effected/cli";
import type { OkfitConfig } from "@okfit/core";
import { loadStaleCandidates, runVerifyIds } from "@okfit/engine";
import type { DateTime } from "effect";
import { Effect } from "effect";
import { humanVerifyBatchDoc } from "../render/verify.js";
import { pickConcepts } from "./verify-picker.js";

/**
 * Issue #228: the interactive half of `okfit stale --verify`. Opens the verify
 * picker over the concepts stale at `now`, then attests the picks and rolls
 * each `stale_after` forward in the same write. Fails `Cancelled` on Esc, `q`,
 * Ctrl-C or a "no" answer, and `NotInteractive` when no screen can mount;
 * writes nothing in either case.
 *
 * @public
 */
export const reverifyStale = (options: {
	readonly bundleRoot: string;
	readonly projectRoot: string;
	readonly config: OkfitConfig;
	readonly now: DateTime.Utc;
	readonly at: DateTime.Utc;
	readonly dryRun: boolean;
}) =>
	Effect.gen(function* () {
		const { bundleRoot, projectRoot, config } = options;
		const picked = yield* pickConcepts(
			{ bundleRoot, projectRoot, config },
			{
				load: loadStaleCandidates({ bundleRoot, projectRoot, config, now: options.now }),
				empty: () => "nothing to re-verify: no stale concepts",
				message: "Re-verify which stale concepts?",
			},
		);
		if (picked === undefined) return;
		const result = yield* runVerifyIds({
			bundleRoot,
			projectRoot,
			config,
			at: options.at,
			dryRun: options.dryRun,
			ids: picked.ids,
			promote: picked.promote,
			refreshStaleAfter: true,
		});
		yield* Doc.print(
			humanVerifyBatchDoc({
				by: result.by,
				at: result.at,
				dryRun: result.dryRun,
				verified: result.verified,
				skipped: result.skipped,
			}),
		);
	});
