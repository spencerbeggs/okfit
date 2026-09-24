export interface SerialQueue {
	/**
	 * Enqueues `task` to run once every previously enqueued task has settled
	 * (resolved or rejected). Returns a promise that reflects `task`'s own
	 * outcome; a rejection never blocks a later `run` call, so one failed
	 * task does not wedge the queue.
	 */
	readonly run: (task: () => Promise<void>) => Promise<void>;
}

/**
 * A FIFO queue of async tasks that never runs two at once. Built for
 * `reactive-vscode`'s `watch`, which does not itself serialize overlapping
 * async callbacks: two rapid config-change events would otherwise both call
 * `start()` concurrently and leak a client. Pure -- no `vscode` import, so
 * this is unit-testable under plain Vitest.
 */
export const createSerialQueue = (): SerialQueue => {
	let tail: Promise<void> = Promise.resolve();
	const run = (task: () => Promise<void>): Promise<void> => {
		const result = tail.then(task, task);
		// Swallow the outcome for the chain itself so a rejection never stops
		// later tasks from running; `result`, returned to the caller, still
		// carries the real outcome.
		tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
	return { run };
};
