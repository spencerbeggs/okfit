import { assert, describe, it } from "@effect/vitest";
import type { RevalidateTier } from "@okfit/engine";
import { Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";
import { makeScheduler } from "../../src/session/scheduler.js";

const recorder = Effect.gen(function* () {
	const runs = yield* Ref.make<ReadonlyArray<RevalidateTier>>([]);
	const scheduler = yield* makeScheduler({
		delay: "150 millis",
		run: (tier) => Ref.update(runs, (all) => [...all, tier]),
	});
	return { runs, scheduler };
});

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

	it.effect("closing the scope interrupts a pending run", () =>
		Effect.gen(function* () {
			const runs = yield* Ref.make<ReadonlyArray<RevalidateTier>>([]);
			yield* Effect.scoped(
				Effect.gen(function* () {
					const scheduler = yield* makeScheduler({
						delay: "150 millis",
						run: (tier) => Ref.update(runs, (all) => [...all, tier]),
					});
					yield* scheduler.schedule("edit");
				}),
			);
			yield* TestClock.adjust("1 second");
			assert.deepStrictEqual(yield* Ref.get(runs), []);
		}),
	);
});
