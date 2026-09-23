import type { RevalidateTier } from "@okfit/engine";
import type { Duration, Scope } from "effect";
import { Effect, Fiber, Option, Ref } from "effect";

/**
 * The debounced revalidate trigger a feature schedules and a workspace
 * folder owns one of. `schedule` coalesces bursts of edits behind a fixed
 * delay; `settle` lets a caller (tests, shutdown) wait for the debounced
 * chain to drain.
 *
 * @public
 */
export interface Scheduler {
	/** Coalesce with any pending run; "full" never downgrades to "edit". */
	readonly schedule: (tier: RevalidateTier) => Effect.Effect<void>;
	/** Wait for a run in flight (or just scheduled) to finish; a no-op when idle. Tests and shutdown use it. */
	readonly settle: Effect.Effect<void>;
}

/**
 * Constructor options for {@link makeScheduler}.
 *
 * @public
 */
export interface SchedulerOptions {
	readonly delay: Duration.Input;
	readonly run: (tier: RevalidateTier) => Effect.Effect<void>;
}

/** Full never downgrades to edit: the merge is a two-value max, "full" wins. */
const maxTier = (a: RevalidateTier, b: RevalidateTier): RevalidateTier =>
	a === "full" || b === "full" ? "full" : "edit";

const mergeTier = (prior: Option.Option<RevalidateTier>, next: RevalidateTier): RevalidateTier =>
	Option.match(prior, { onNone: () => next, onSome: (tier) => maxTier(tier, next) });

interface Entry {
	/** The fiber running the current debounce-then-revalidate chain. */
	readonly fiber: Fiber.Fiber<void>;
	/** "pending" while waiting out the delay; "running" once `run` has started. */
	readonly phase: "pending" | "running";
	/** The tier this chain will run (or is running) with. */
	readonly tier: RevalidateTier;
	/** A tier requested while this chain was running, to run again once it finishes. */
	readonly rerun: Option.Option<RevalidateTier>;
}

type State = Option.Option<Entry>;

type ScheduleAction =
	| { readonly _tag: "merged" }
	| { readonly _tag: "start"; readonly priorFiber: Option.Option<Fiber.Fiber<void>>; readonly tier: RevalidateTier };

/**
 * Builds a {@link Scheduler}: at most one debounce-then-revalidate chain is
 * ever in flight. A `schedule` call while idle or pending restarts the delay
 * and folds the new tier into the pending one (never downgrading); a
 * `schedule` call while a run is in flight records the tier to run again
 * once the current run finishes, so an edit made during a slow revalidate is
 * not lost. Closing the scope this was built under interrupts a pending or
 * running chain.
 *
 * @public
 */
export const makeScheduler = (options: SchedulerOptions): Effect.Effect<Scheduler, never, Scope.Scope> =>
	Effect.gen(function* () {
		const scope = yield* Effect.scope;
		const state = yield* Ref.make<State>(Option.none());

		const chain = (fiberBox: { fiber: Fiber.Fiber<void> | undefined }, tier: RevalidateTier): Effect.Effect<void> =>
			Effect.gen(function* () {
				yield* Effect.sleep(options.delay);
				yield* Ref.update(
					state,
					Option.map((entry) => ({ ...entry, phase: "running" as const, rerun: Option.none() })),
				);
				yield* options.run(tier);
				const rerun = yield* Ref.modify(state, (entry) => [
					Option.isSome(entry) ? entry.value.rerun : Option.none<RevalidateTier>(),
					Option.none(),
				]);
				if (Option.isSome(rerun)) {
					yield* schedule(rerun.value);
				}
			}).pipe(
				Effect.ensuring(
					Ref.update(state, (entry) =>
						Option.isSome(entry) && entry.value.fiber === fiberBox.fiber ? Option.none() : entry,
					),
				),
			);

		const schedule = (tier: RevalidateTier): Effect.Effect<void> =>
			Effect.gen(function* () {
				const action = yield* Ref.modify(state, (entry): readonly [ScheduleAction, State] => {
					if (Option.isSome(entry) && entry.value.phase === "running") {
						return [
							{ _tag: "merged" },
							Option.some({ ...entry.value, rerun: Option.some(mergeTier(entry.value.rerun, tier)) }),
						];
					}
					const priorFiber = Option.isSome(entry) ? Option.some(entry.value.fiber) : Option.none();
					const priorTier = Option.isSome(entry) ? Option.some(entry.value.tier) : Option.none();
					return [{ _tag: "start", priorFiber, tier: mergeTier(priorTier, tier) }, Option.none()];
				});

				if (action._tag === "merged") return;

				if (Option.isSome(action.priorFiber)) {
					yield* Fiber.interrupt(action.priorFiber.value);
				}

				const fiberBox: { fiber: Fiber.Fiber<void> | undefined } = { fiber: undefined };
				const fiber = yield* Effect.forkIn(chain(fiberBox, action.tier), scope);
				fiberBox.fiber = fiber;
				yield* Ref.set(state, Option.some({ fiber, phase: "pending", tier: action.tier, rerun: Option.none() }));
			});

		const settle: Effect.Effect<void> = Effect.gen(function* () {
			let current = yield* Ref.get(state);
			while (Option.isSome(current)) {
				yield* Fiber.join(current.value.fiber);
				current = yield* Ref.get(state);
			}
		});

		return { schedule, settle };
	});
