import { Cancelled, CliInteractive } from "@effected/cli";
import { CliUi, Confirm } from "@effected/cli/ui";
import type { SyncOptions } from "@okfit/engine";
import { applySyncPlan, planSync, runSync } from "@okfit/engine";
import { Console, Effect } from "effect";
import { humanSync } from "../render/sync.js";

/**
 * Issue #229: an interactive `okfit sync` shows what it would write and asks
 * before writing. Everything else is `runSync`, unchanged.
 *
 * The prompt appears only when the run is interactive (a terminal, not the
 * agent or CI audience, not a pipe) and is not `--dry-run`, `--staged` or
 * `--yes`. `--staged` never prompts, even on a terminal: a human can run the
 * pre-commit hook. A plan with nothing to write applies silently. A "no" or
 * Esc fails `Cancelled` (exit 130) with nothing written; a prompt that cannot
 * mount (`NotInteractive`) falls back to writing, so a pipe never blocks.
 */
export const syncWithConfirm = (options: SyncOptions, yes: boolean) =>
	Effect.gen(function* () {
		if (yes || options.dryRun || options.staged !== undefined || !(yield* CliInteractive)) {
			return yield* runSync(options);
		}
		const plan = yield* planSync(options);
		const { generated, index, log } = plan.result;
		const count = generated.written.length + index.written.length + log.written.length;
		if (count === 0) return yield* applySyncPlan(plan);
		for (const line of humanSync(plan.result)) yield* Console.log(line);
		const answer = yield* CliUi.prompt(Confirm.screen({ message: `Write ${count} file(s)?`, initial: true })).pipe(
			Effect.catchTag("NotInteractive", () => Effect.succeed(undefined)),
		);
		if (answer !== undefined && !answer.confirmed) return yield* new Cancelled({ reason: "escape" });
		return yield* applySyncPlan(plan);
	});
