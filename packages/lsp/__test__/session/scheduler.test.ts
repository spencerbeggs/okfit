import { assert, describe, it } from "@effect/vitest";
import type { RevalidateTier } from "@okfit/engine";
import type { Duration } from "effect";
import { Effect, Exit, Fiber, Ref } from "effect";
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
