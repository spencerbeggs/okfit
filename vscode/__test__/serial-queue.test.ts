import { describe, expect, it } from "vitest";
import { createSerialQueue } from "../src/serial-queue.js";

describe("createSerialQueue", () => {
	it("runs a second task only after the first settles", async () => {
		const queue = createSerialQueue();
		const events: Array<string> = [];
		let releaseFirst: () => void = () => {};
		const first = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});

		const p1 = queue.run(async () => {
			events.push("first:start");
			await first;
			events.push("first:end");
		});
		const p2 = queue.run(async () => {
			events.push("second:start");
		});

		// Give the first task's microtasks a chance to run; it must not have
		// resolved yet, so the second task must not have started.
		await Promise.resolve();
		await Promise.resolve();
		expect(events).toEqual(["first:start"]);

		releaseFirst();
		await p1;
		await p2;
		expect(events).toEqual(["first:start", "first:end", "second:start"]);
	});

	it("keeps running later tasks after an earlier one rejects, and reports each task's own outcome", async () => {
		const queue = createSerialQueue();
		const events: Array<string> = [];

		const p1 = queue.run(async () => {
			events.push("first");
			throw new Error("boom");
		});
		const p2 = queue.run(async () => {
			events.push("second");
		});

		await expect(p1).rejects.toThrow("boom");
		await expect(p2).resolves.toBeUndefined();
		expect(events).toEqual(["first", "second"]);
	});

	it("runs tasks enqueued one at a time in call order", async () => {
		const queue = createSerialQueue();
		const events: Array<string> = [];

		await queue.run(async () => {
			events.push("a");
		});
		await queue.run(async () => {
			events.push("b");
		});
		await queue.run(async () => {
			events.push("c");
		});

		expect(events).toEqual(["a", "b", "c"]);
	});
});
