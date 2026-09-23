/**
 * `createDebouncer`: a trailing-edge debounce with no `vscode` dependency,
 * so it is unit-testable with fake timers. `trigger()` restarts the
 * `delayMs` timer; `run` fires once after the burst goes quiet. `dispose()`
 * cancels a pending timer without running `run` -- the caller's own
 * teardown path, never invoked by the debouncer itself.
 */
export interface Debouncer {
	/** Restarts the trailing timer; coalesces a burst of calls into one eventual `run()`. */
	readonly trigger: () => void;
	/** Cancels a pending timer, if any, without running `run`. */
	readonly dispose: () => void;
}

export const createDebouncer = (delayMs: number, run: () => void): Debouncer => {
	let timer: ReturnType<typeof setTimeout> | undefined;

	const trigger = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			run();
		}, delayMs);
	};

	const dispose = (): void => {
		if (timer === undefined) return;
		clearTimeout(timer);
		timer = undefined;
	};

	return { trigger, dispose };
};
