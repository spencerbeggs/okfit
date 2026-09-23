import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "../src/debounce.js";

describe("createDebouncer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs once, after the delay, following a single trigger", () => {
		const run = vi.fn();
		const debouncer = createDebouncer(250, run);
		debouncer.trigger();
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(249);
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("coalesces a burst of triggers into a single trailing run", () => {
		const run = vi.fn();
		const debouncer = createDebouncer(250, run);
		debouncer.trigger();
		vi.advanceTimersByTime(100);
		debouncer.trigger();
		vi.advanceTimersByTime(100);
		debouncer.trigger();
		vi.advanceTimersByTime(249);
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("runs again for a trigger after an earlier burst already ran", () => {
		const run = vi.fn();
		const debouncer = createDebouncer(250, run);
		debouncer.trigger();
		vi.advanceTimersByTime(250);
		expect(run).toHaveBeenCalledTimes(1);
		debouncer.trigger();
		vi.advanceTimersByTime(250);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("dispose cancels a pending trigger without running it", () => {
		const run = vi.fn();
		const debouncer = createDebouncer(250, run);
		debouncer.trigger();
		debouncer.dispose();
		vi.advanceTimersByTime(1000);
		expect(run).not.toHaveBeenCalled();
	});

	it("dispose is a no-op when nothing is pending", () => {
		const run = vi.fn();
		const debouncer = createDebouncer(250, run);
		expect(() => debouncer.dispose()).not.toThrow();
	});
});
