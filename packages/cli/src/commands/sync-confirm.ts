import { Cancelled, CliInteractive } from "@effected/cli-kit";
import { CliUi } from "@effected/cli-kit/ui";
import type { SyncOptions, SyncResult } from "@okfit/engine";
import { applySyncPlan, planSync, runSync } from "@okfit/engine";
import { Effect } from "effect";
import { humanSync } from "../render/sync.js";

/**
 * Issue #229: an interactive `okfit sync` shows what it would write and asks
 * before writing. Everything else is `runSync`, unchanged.
 *
 * The plan is part of the confirm screen (issue #269), not printed before it,
 * so a prompt that cannot mount prints nothing and the write report appears
 * exactly once.
 *
 * The prompt appears only when the run is interactive (a terminal, not the
 * agent or CI audience, not a pipe) and is not `--dry-run`, `--staged` or
 * `--yes`. `--staged` never prompts, even on a terminal: a human can run the
 * pre-commit hook. A plan with nothing to write applies silently. A "no" or
 * Esc fails `Cancelled` (exit 130) with nothing written; a prompt that cannot
 * mount (`NotInteractive`) falls back to writing, so a pipe never blocks.
 */
/** Files a plan rewrites: generated concepts written or migrated (once each), plus index and log. */
export const writeCount = (result: SyncResult): number =>
	new Set([...result.generated.written, ...result.generated.migrated]).size +
	result.index.written.length +
	result.log.written.length;

/** The real prompt: the plan's lines above a yes/no, mounted lazily so Ink and React load only here. */
const planPrompt = (lines: ReadonlyArray<string>, message: string) =>
	CliUi.prompt(
		CliUi.lazy(() =>
			import("./sync-confirm-screen.js").then((module) => ({
				default: module.planConfirmScreen({ lines, message }),
			})),
		),
	);

export const syncWithConfirm = (
	options: SyncOptions,
	yes: boolean,
	confirm: (lines: ReadonlyArray<string>, message: string) => ReturnType<typeof planPrompt> = planPrompt,
) =>
	Effect.gen(function* () {
		if (yes || options.dryRun || options.staged !== undefined || !(yield* CliInteractive)) {
			return yield* runSync(options);
		}
		const plan = yield* planSync(options);
		const count = writeCount(plan.result);
		if (count === 0) return yield* applySyncPlan(plan);
		const answer = yield* confirm(humanSync(plan.result), `Write ${count} file(s)?`).pipe(
			Effect.catchTag("NotInteractive", () => Effect.succeed(undefined)),
		);
		if (answer !== undefined && !answer.confirmed) return yield* new Cancelled({ reason: "escape" });
		return yield* applySyncPlan(plan);
	});
