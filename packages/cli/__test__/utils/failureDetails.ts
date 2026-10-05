import type { FailureDetails } from "@effected/cli";
import { Cancelled, CliRuntime, NotInteractive } from "@effected/cli";
import { Cause } from "effect";
import { renderFailure } from "../../src/errors.js";

/**
 * A `FailureDetails` outside a run: `lines` is the kit's run-less equivalent,
 * `CliRuntime.defaultRender` (plain, absolute paths). The two flags test the
 * error's class, as the kit's own do; a cancelled or non-interactive run's
 * `defaultLines` is its fixed line, the error's `message`.
 */
export const detailsOf = (error: unknown, cause: Cause.Cause<unknown>, isDefect: boolean): FailureDetails => {
	const isCancelled = error instanceof Cancelled;
	const isNotInteractive = error instanceof NotInteractive;
	return {
		cause,
		isDefect,
		isCancelled,
		isNotInteractive,
		defaultLines:
			error instanceof Cancelled || error instanceof NotInteractive ? [error.message] : ["[FAIL] the run's own report"],
		lines: (options) => {
			const rendered = CliRuntime.defaultRender(error, { cause, isDefect }, options);
			return typeof rendered === "string" ? rendered.split("\n") : rendered;
		},
	};
};

/** `renderFailure` for a typed failure from the error channel. */
export const renderTyped = (error: unknown): ReadonlyArray<string> =>
	renderFailure(error, detailsOf(error, Cause.fail(error), false));

/** `renderFailure` for a defect (a `die`). */
export const renderDefect = (error: unknown): ReadonlyArray<string> =>
	renderFailure(error, detailsOf(error, Cause.die(error), true));
