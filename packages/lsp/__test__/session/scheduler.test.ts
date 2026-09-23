import { assert, describe, it } from "@effect/vitest";
import type { RevalidateTier } from "@okfit/engine";
import type { Duration } from "effect";
import { Deferred, Effect, Exit, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import type { SchedulerOptions } from "../../src/session/scheduler.js";
import { makeScheduler } from "../../src/session/scheduler.js";

/**
 * `maxWait` defaults to ten seconds, far past every existing case's total
 * elapsed adjustment, so the ceiling this scheduler now carries never fires
 * unless a case sets a shorter one on purpose.
 */
const makeRecorder = (overrides: Partial<Pick<SchedulerOptions, "delay" | "maxWait">> = {}) =>
	Effect.gen(function* () {
		const runs = yield* Ref.make<ReadonlyArray<RevalidateTier>>([]);
		const scheduler = yield* makeScheduler({
			delay: overrides.delay ?? "150 millis",
			maxWait: overrides.maxWait ?? "10 seconds",
			run: (tier) => Ref.update(runs, (all) => [...all, tier]),
		});
		return { runs, scheduler };
	});

const recorder = makeRecorder();

const withMaxWait = (maxWait: Duration.Input) => makeRecorder({ maxWait });

describe("makeScheduler", () => {
	it.effect("three edits inside the window run once, after the window", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* recorder;
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			assert.deepStrictEqual(yield* Ref.get(runs), []);
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit"]);
		}).pipe(Effect.scoped),
	);

	it.effect("a full trigger inside an edit burst runs full; an edit after a full keeps full (never downgrades)", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* recorder;
			yield* scheduler.schedule("edit");
			yield* scheduler.schedule("full");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["full"]);
		}).pipe(Effect.scoped),
	);

	it.effect("two bursts separated by more than the window run twice (positive control)", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* recorder;
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			yield* scheduler.schedule("full");
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit", "full"]);
		}).pipe(Effect.scoped),
	);

	it.effect("a schedule during a run queues one more run after it (an edit during a slow revalidate is not lost)", () =>
		Effect.gen(function* () {
			const runs = yield* Ref.make<ReadonlyArray<RevalidateTier>>([]);
			const scheduler = yield* makeScheduler({
				delay: "150 millis",
				maxWait: "10 seconds",
				run: (tier) => Effect.sleep("1 second").pipe(Effect.andThen(Ref.update(runs, (all) => [...all, tier]))),
			});
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("150 millis");
			yield* TestClock.adjust("500 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("500 millis");
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit"]);
			yield* TestClock.adjust("150 millis");
			yield* TestClock.adjust("1 second");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit", "edit"]);
		}).pipe(Effect.scoped),
	);

	it.effect("concurrent schedule calls contending for a pending chain coalesce into one run", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* recorder;
			yield* scheduler.schedule("edit");
			const a = yield* Effect.forkChild(scheduler.schedule("edit"));
			const b = yield* Effect.forkChild(scheduler.schedule("edit"));
			yield* Fiber.join(a);
			yield* Fiber.join(b);
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit"]);
		}).pipe(Effect.scoped),
	);

	it.effect("a full among concurrent schedule calls contending for a pending chain wins the single run", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* recorder;
			yield* scheduler.schedule("edit");
			const a = yield* Effect.forkChild(scheduler.schedule("edit"));
			const b = yield* Effect.forkChild(scheduler.schedule("full"));
			yield* Fiber.join(a);
			yield* Fiber.join(b);
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["full"]);
		}).pipe(Effect.scoped),
	);

	it.effect("settle succeeds when the chain it is waiting on is interrupted by a later schedule", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* recorder;
			yield* scheduler.schedule("edit");
			const settling = yield* Effect.forkChild(scheduler.settle);
			yield* Effect.yieldNow;
			// Replaces the pending chain `settling` is waiting on.
			yield* scheduler.schedule("full");
			yield* TestClock.adjust("150 millis");
			const exit = yield* Fiber.await(settling);
			assert.isTrue(Exit.isSuccess(exit));
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["full"]);
		}).pipe(Effect.scoped),
	);

	it.effect("closing the scope interrupts a pending run", () =>
		Effect.gen(function* () {
			const runs = yield* Ref.make<ReadonlyArray<RevalidateTier>>([]);
			yield* Effect.scoped(
				Effect.gen(function* () {
					const scheduler = yield* makeScheduler({
						delay: "150 millis",
						maxWait: "10 seconds",
						run: (tier) => Ref.update(runs, (all) => [...all, tier]),
					});
					yield* scheduler.schedule("edit");
				}),
			);
			yield* TestClock.adjust("1 second");
			assert.deepStrictEqual(yield* Ref.get(runs), []);
		}),
	);

	it.effect("a burst that quiets before maxWait runs once, through the normal debounce (positive control)", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* withMaxWait("500 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			// 200 ms since the first schedule, well under the 500 ms ceiling: nothing has run yet.
			assert.deepStrictEqual(yield* Ref.get(runs), []);
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit"]);
		}).pipe(Effect.scoped),
	);

	it.effect("a burst that never quiets for delay still runs at maxWait after the first schedule (the ceiling)", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* withMaxWait("500 millis");
			// Re-schedule every 100 ms, so the 150 ms debounce never elapses quietly on its own: the fifth
			// schedule lands at 400 ms and would next elapse at 550 ms, past the 500 ms ceiling.
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			// Advancing only to 500 ms (not the 550 ms the last schedule's own debounce would need) still runs:
			// the ceiling forced it.
			yield* TestClock.adjust("100 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit"]);
		}).pipe(Effect.scoped),
	);

	it.effect(
		"a schedule issued exactly as the chain enters the running phase is serviced as a queued run, not an aborted one",
		() =>
			Effect.gen(function* () {
				const runs = yield* Ref.make<ReadonlyArray<RevalidateTier>>([]);
				const gate = yield* Deferred.make<void>();
				const scheduler = yield* makeScheduler({
					delay: "150 millis",
					maxWait: "10 seconds",
					run: (tier) => Deferred.await(gate).pipe(Effect.andThen(Ref.update(runs, (all) => [...all, tier]))),
				});
				yield* scheduler.schedule("edit");
				yield* TestClock.adjust("150 millis");
				// The chain has transitioned to "running" and is blocked inside `run`, holding the gate: this
				// deterministically pins it in the running phase, so the schedule below lands squarely inside
				// the run rather than racing the pending-to-running transition itself -- a race the
				// single-writer permit now makes impossible to observe from outside the module.
				yield* scheduler.schedule("full");
				// Not aborted: the in-flight run has not recorded anything yet (it is still blocked on the
				// gate), and it is still the one and only run in flight -- a lost/aborted chain would leave
				// this array empty forever, never producing "edit" once the gate opens.
				assert.deepStrictEqual(yield* Ref.get(runs), []);
				const settling = yield* Effect.forkChild(scheduler.settle);
				yield* Deferred.succeed(gate, undefined);
				yield* TestClock.adjust("150 millis");
				const exit = yield* Fiber.await(settling);
				assert.isTrue(Exit.isSuccess(exit));
				// settle returned only once both the in-flight "edit" and the queued, merged "full" had run.
				assert.deepStrictEqual(yield* Ref.get(runs), ["edit", "full"]);
			}).pipe(Effect.scoped),
	);

	it.effect("a schedule racing the instant a run completes is serviced exactly once, never as a ghost entry", () =>
		Effect.gen(function* () {
			// Best-effort approximation of the race, not a guaranteed interleaving: forking `schedule`
			// right as the gate that unblocks the finishing run opens puts the finalizer's reset-to-idle
			// write and the fresh `schedule` call in contention for the same permit, but the underlying
			// fiber scheduler decides which actually runs first. Both orderings are asserted here because
			// the single-writer design makes both orderings converge on the same observable outcome.
			const runs = yield* Ref.make<ReadonlyArray<RevalidateTier>>([]);
			const gate = yield* Deferred.make<void>();
			const scheduler = yield* makeScheduler({
				delay: "150 millis",
				maxWait: "10 seconds",
				run: (tier) => Deferred.await(gate).pipe(Effect.andThen(Ref.update(runs, (all) => [...all, tier]))),
			});
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("150 millis");
			// The chain is blocked inside `run`, holding the gate. Opening it lets the chain's own
			// continuation (recording the run, consuming any rerun, resetting the slot to idle) proceed;
			// forking `schedule` in the same breath races it against exactly that continuation instead of
			// against a chain still parked mid-`run` (which the first test above already covers).
			yield* Deferred.succeed(gate, undefined);
			const raced = yield* Effect.forkChild(scheduler.schedule("full"));
			yield* Fiber.join(raced);
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			// Exactly one further run, with the merged tier -- never zero (a ghost entry nobody
			// services) and never duplicated (two chains servicing the same queued tier).
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit", "full"]);
		}).pipe(Effect.scoped),
	);

	it.effect("the ceiling resets after a run: the next cycle gets its own fresh maxWait window", () =>
		Effect.gen(function* () {
			const { runs, scheduler } = yield* withMaxWait("500 millis");
			// First cycle: force a run at the 500 ms ceiling, exactly as the previous case.
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.schedule("edit");
			yield* TestClock.adjust("100 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit"]);
			// Second cycle starts fresh at t = 500 ms. A stale, unreset ceiling would already have elapsed and
			// force this schedule to run immediately; instead nothing runs until the ordinary 150 ms debounce.
			yield* scheduler.schedule("full");
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit"]);
			yield* TestClock.adjust("150 millis");
			yield* scheduler.settle;
			assert.deepStrictEqual(yield* Ref.get(runs), ["edit", "full"]);
		}).pipe(Effect.scoped),
	);
});
