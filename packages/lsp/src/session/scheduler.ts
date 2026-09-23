import type { RevalidateTier } from "@okfit/engine";
import type { Duration, Scope } from "effect";
import { Cause, Deferred, Effect, Fiber, Option, SynchronizedRef } from "effect";

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
 * The scheduler's state lives in one `SynchronizedRef`, and it has exactly
 * one writer at a time: `schedule`'s idle-or-pending transition, the chain's
 * phase-to-running write, its post-run rerun-and-reset write, and the
 * finalizer's reset-to-idle all go through the ref's own semaphore-guarded
 * `modify`/`update` operations, never its raw `backing` `Ref`. That is what
 * makes the two races a reviewer can otherwise construct impossible: a
 * `schedule` call can no longer observe a chain's still-"pending" snapshot at
 * the exact instant the chain writes "running" (it would abort a live run and
 * drop the queued-run bookkeeping), and a chain's finalizer can no longer
 * reset a slot a newer chain has already taken over (it would leave a ghost
 * entry pointing at a dead fiber). Every chain-side write also carries a
 * fiber-identity check against the entry it reads, so a write from a chain
 * that has already been superseded — its interrupt requested but not yet
 * delivered — is a safe no-op instead of clobbering the entry the newer chain
 * now owns.
 *
 * The one place this could deadlock: `schedule`'s replace-pending branch
 * interrupting the prior chain. `Fiber.interrupt` awaits the interrupted
 * fiber's finalizers, and this scheduler's finalizer needs the very permit
 * `schedule` is holding to reset itself — awaiting the interrupt inline would
 * make `schedule` wait on a fiber that is in turn waiting on `schedule`. So
 * `schedule` forks the interrupt into the scheduler's scope instead of
 * awaiting it: the permit is released as soon as the new chain is recorded,
 * the superseded chain's finalizer can then acquire it whenever the
 * interrupt actually lands, and its identity check makes the timing of that
 * landing irrelevant to correctness.
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

				// Claim the slot, but only if it is still ours: a `schedule` call may already have replaced
				// this entry (its interrupt of this fiber requested but not yet delivered). Gating `run` on
				// that claim makes this chain's behaviour correct regardless of how quickly the interrupt
				// actually lands, instead of depending on that timing.
				const stillOwns = yield* SynchronizedRef.modify(state, (entry) =>
					Option.isSome(entry) && entry.value.fiber === fiberBox.fiber
						? ([true, Option.some({ ...entry.value, phase: "running" as const, rerun: Option.none() })] as const)
						: ([false, entry] as const),
				);
				if (!stillOwns) {
					return;
				}

				yield* options.run(tier);

				// Consume any tier requested while this chain was running, and reset the slot to idle in the
				// same guarded write so no observer can see "running" with the rerun already cleared but the
				// slot not yet free. Guarded by the same identity check: this chain owns the slot throughout
				// `run` (schedule never interrupts a running chain, only a pending one), so the check here is
				// a defensive no-op in the ordinary path, not a case this scheduler expects to hit.
				const rerun = yield* SynchronizedRef.modify(state, (entry) =>
					Option.isSome(entry) && entry.value.fiber === fiberBox.fiber
						? ([entry.value.rerun, Option.none<Entry>()] as const)
						: ([Option.none<RevalidateTier>(), entry] as const),
				);
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
					SynchronizedRef.update(state, (entry) =>
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
							// Forked, not awaited: awaiting here would wait for the superseded chain's finalizer,
							// which needs this very permit to reset itself (see the module doc). Forking into the
							// scheduler's scope still interrupts it and still gets swept up on scope close; this
							// permit is simply released before that interrupt is delivered.
							yield* Effect.forkIn(Fiber.interrupt(entry.value.fiber), scope);
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
			let current = yield* SynchronizedRef.get(state);
			while (Option.isSome(current)) {
				yield* Fiber.await(current.value.fiber);
				current = yield* SynchronizedRef.get(state);
			}
		});

		return { schedule, settle };
	});
