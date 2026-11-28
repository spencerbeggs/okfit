import type { MigrationCode, MigrationFixPlan } from "@okfit/engine";
import { Effect, Option } from "effect";

/**
 * The refusals an un-narrowed `--fix` would report, for the validate summary. A plan that fails counts none, so a
 * report never fails because its plan did (#498); a defect still propagates.
 *
 * @internal
 */
export const summaryRefusals = <E, R>(
	plan: Effect.Effect<MigrationFixPlan, E, R>,
): Effect.Effect<ReadonlyArray<{ readonly file: string; readonly code: MigrationCode }>, never, R> =>
	plan.pipe(
		Effect.option,
		Effect.map(
			Option.match({
				onNone: () => [],
				onSome: (p) => p.refused.map(({ file, code }) => ({ file, code })),
			}),
		),
	);
