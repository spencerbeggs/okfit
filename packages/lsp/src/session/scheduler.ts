import type { RevalidateTier } from "@okfit/engine";
import type { Duration, Scope } from "effect";
import { Cause, Deferred, Effect, Fiber, Option, Ref, SynchronizedRef } from "effect";

/**
 * The debounced revalidate trigger a feature schedules and a workspace
 * folder owns one of. `schedule` coalesces bursts of edits behind a fixed
 * delay, bounded by a ceiling so a burst that never quiets still runs;
 * `settle` lets a caller (tests, shutdown) wait for the debounced chain to
 * drain.
 *
 * @public
 */
export interface Scheduler {
	/**
	 * Coalesce with any pending run; "full" never downgrades to "edit".
	 * Calls are serialized (the state's own synchronized permit), so
	 * concurrent handlers calling `schedule` at the same time cannot both
	 * observe an idle slot and orphan one of their forked chains.
	 */
	readonly schedule: (tier: RevalidateTier) => Effect.Effect<void>;
	/** Wait for a run in flight (or just scheduled) to finish; a no-op when idle. Never fails, even when a chain it waited on was interrupted or died. Tests and shutdown use it. */
	readonly settle: Effect.Effect<void>;
}

/**
 * Constructor options for {@link makeScheduler}.
 *
 * @public
 */
export interface SchedulerOptions {
	readonly delay: Duration.Input;
	/**
	 * Upper bound, measured from the first `schedule` of an idle scheduler,
	 * on how long a steady stream of `schedule` calls can defer a run: a
	 * burst that never goes quiet for `delay` still runs at most `maxWait`
	 * after it started. Coalescing merges within that window (decision 9 in
	 * the phase 4 plan) do not push the bound back, only a run completing
	 * and a fresh idle-to-pending cycle starting does. No default here; the
	 * caller applies one, matching `delay` (`ServeOptions.maxWait` in
	 * `server.ts`).
	 */
	readonly maxWait: Duration.Input;
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
	/**
	 * The maxWait ceiling fiber for this idle-to-pending cycle: forked once,
	 * when the cycle starts from idle, and carried unchanged across every
	 * coalescing `schedule` call that merges into it, so the ceiling never
	 * resets on a later edit. A fresh cycle (the next `schedule` after a run
	 * completes) forks its own.
	 */
	readonly ceiling: Fiber.Fiber<void>;
	/** Resolved by `ceiling` once `maxWait` elapses; the chain races it against `options.delay`. */
	readonly forceNow: Deferred.Deferred<void>;
	/** "pending" while waiting out the delay (or the ceiling); "running" once `run` has started. */
	readonly phase: "pending" | "running";
	/** The tier this chain will run (or is running) with. */
	readonly tier: RevalidateTier;
	/** A tier requested while this chain was running, to run again once it finishes. */
	readonly rerun: Option.Option<RevalidateTier>;
}

type State = Option.Option<Entry>;

/**
 * Builds a {@link Scheduler}: at most one debounce-then-revalidate chain is
 * ever in flight. A `schedule` call while idle or pending restarts the delay
 * and folds the new tier into the pending one (never downgrading); a
 * `schedule` call while a run is in flight records the tier to run again
 * once the current run finishes, so an edit made during a slow revalidate is
 * not lost. A steady stream of `schedule` calls that never lets `delay`
 * elapse quietly still runs once `maxWait` has passed since the first
 * `schedule` of the idle cycle (decision 9 in the phase 4 plan). Closing the
 * scope this was built under interrupts a pending or running chain.
 *
 * The scheduler's state lives in one `SynchronizedRef`: `schedule`'s
 * idle-or-pending transition runs inside `SynchronizedRef.modifyEffect`, so
 * concurrent `schedule` calls serialize on its own semaphore exactly as the
 * former `Ref` + `Semaphore` pair did. The debounce-then-run chain itself
 * reads and writes the ref's raw `backing` `Ref` instead of going through
 * that semaphore: `schedule` interrupts a prior chain from inside its own
 * serialized transition, and `Fiber.interrupt` waits for the interrupted
 * fiber's finalizers (which update this same state) to finish, so routing
 * the chain's updates through the semaphore too would deadlock `schedule`
 * against the very fiber it is interrupting.
 *
 * @public
 */
export const makeScheduler = (options: SchedulerOptions): Effect.Effect<Scheduler, never, Scope.Scope> =>
	Effect.gen(function* () {
		const scope = yield* Effect.scope;
		const state = yield* SynchronizedRef.make<State>(Option.none());

		/** Forks a fresh ceiling fiber and its `forceNow` deferred for a new idle-to-pending cycle. */
		const startCycle = (): Effect.Effect<{
			readonly ceiling: Fiber.Fiber<void>;
			readonly forceNow: Deferred.Deferred<void>;
		}> =>
			Effect.gen(function* () {
				const forceNow = yield* Deferred.make<void>();
				const ceiling = yield* Effect.forkIn(
					Effect.sleep(options.maxWait).pipe(Effect.andThen(Deferred.succeed(forceNow, undefined)), Effect.asVoid),
					scope,
				);
				return { ceiling, forceNow };
			});

		const chain = (
			fiberBox: { fiber: Fiber.Fiber<void> | undefined },
			tier: RevalidateTier,
			forceNow: Deferred.Deferred<void>,
			ceiling: Fiber.Fiber<void>,
		): Effect.Effect<void> =>
			Effect.gen(function* () {
				// Whichever comes first: the debounce settling, or the burst having run past the ceiling.
				yield* Effect.race(Effect.sleep(options.delay), Deferred.await(forceNow));
				yield* Ref.update(
					state.backing,
					Option.map((entry) => ({ ...entry, phase: "running" as const, rerun: Option.none() })),
				);
				yield* options.run(tier);
				const rerun = yield* Ref.modify(state.backing, (entry) => [
					Option.isSome(entry) ? entry.value.rerun : Option.none<RevalidateTier>(),
					Option.none(),
				]);
				// Already resolved (this run started from the ceiling) or no longer needed (it started from the
				// delay elapsing first): interrupting it either way is a fast no-op.
				yield* Fiber.interrupt(ceiling);
				if (Option.isSome(rerun)) {
					yield* schedule(rerun.value);
				}
			}).pipe(
				// A later `schedule` interrupting this chain is the normal path; anything else is a defect worth a line.
				Effect.tapCause((cause) =>
					Cause.hasInterruptsOnly(cause)
						? Effect.void
						: Effect.logWarning(`okfit-lsp: a revalidate chain failed: ${Cause.pretty(cause)}`),
				),
				Effect.ensuring(
					Ref.update(state.backing, (entry) =>
						Option.isSome(entry) && entry.value.fiber === fiberBox.fiber ? Option.none() : entry,
					),
				),
			);

		const schedule = (tier: RevalidateTier): Effect.Effect<void> =>
			SynchronizedRef.modifyEffect(
				state,
				(entry): Effect.Effect<readonly [undefined, State]> =>
					Effect.gen(function* () {
						if (Option.isSome(entry) && entry.value.phase === "running") {
							return [
								undefined,
								Option.some({ ...entry.value, rerun: Option.some(mergeTier(entry.value.rerun, tier)) }),
							];
						}

						// Idle, or pending and coalescing: reuse the pending entry's cycle (its ceiling keeps counting
						// down from its own first schedule), or start a fresh one from idle.
						const cycle = Option.isSome(entry)
							? { ceiling: entry.value.ceiling, forceNow: entry.value.forceNow }
							: yield* startCycle();

						if (Option.isSome(entry)) {
							yield* Fiber.interrupt(entry.value.fiber);
						}

						const mergedTier = mergeTier(Option.isSome(entry) ? Option.some(entry.value.tier) : Option.none(), tier);
						const fiberBox: { fiber: Fiber.Fiber<void> | undefined } = { fiber: undefined };
						const fiber = yield* Effect.forkIn(chain(fiberBox, mergedTier, cycle.forceNow, cycle.ceiling), scope);
						fiberBox.fiber = fiber;

						return [
							undefined,
							Option.some({
								fiber,
								ceiling: cycle.ceiling,
								forceNow: cycle.forceNow,
								phase: "pending" as const,
								tier: mergedTier,
								rerun: Option.none<RevalidateTier>(),
							}),
						];
					}),
			);

		// `Fiber.await`, not `Fiber.join`: a chain interrupted by a later `schedule` (or one that died) must not
		// fail `settle`, or `shutdown` would answer with an internal error. The loop then waits on the replacement.
		const settle: Effect.Effect<void> = Effect.gen(function* () {
			let current = yield* Ref.get(state.backing);
			while (Option.isSome(current)) {
				yield* Fiber.await(current.value.fiber);
				current = yield* Ref.get(state.backing);
			}
		});

		return { schedule, settle };
	});
