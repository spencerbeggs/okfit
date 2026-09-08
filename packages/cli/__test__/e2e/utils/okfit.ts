import { resolve } from "node:path";
import type { CommandFailedError, CommandOutputError } from "@effected/commands"; // CMD/Run.d.ts:365, :412
import { Run } from "@effected/commands"; // CMD/Run.d.ts:452
import type { Effect } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { ChildProcess } from "effect/unstable/process";

/** The built dev bin, resolved from this file's own location (contract section 6.3). */
export const BIN: string = resolve(import.meta.dirname, "..", "..", "..", "dist", "dev", "pkg", "bin", "okfit.js");

/** Everything one `okfit` run produced. */
export interface OkfitRun {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

/**
 * One spawn of the built bin (K-43): `ChildProcess.make(process.execPath,
 * [BIN, ...args], { env })` through `Run.collect` (G-3, okfit #5), `env` explicit and
 * `extendEnv` never set — `PATH` passed through, `HOME` and all four
 * `XDG_*` variables pointed at per-test temp directories (a `Sandbox` from
 * `fixtures.ts`), `NO_COLOR=1`, and `OKFIT_NOW` when a test needs a fixed
 * clock.
 *
 * A non-zero exit is DATA, never a failure: `1`, `2`, `3` and `64` are
 * frequently the thing under test — `Run.collect` never turns a non-zero
 * exit into a typed failure (its `CommandOutput.exitCode` carries it). The
 * error channel widens to `Run.collect`'s own taxonomy
 * (`CommandFailedError` for a spawn that never started or a timeout,
 * `CommandOutputError` for output over `Run.collect`'s 16 MiB per-stream
 * ceiling — never exercised here, the CLI runs over small fixtures) rather
 * than the narrower `PlatformError` this helper carried before delegating
 * (K-9..K-11): acceptable for a TEST helper, per G-3.
 *
 * @public
 */
export const runOkfit = (
	args: ReadonlyArray<string>,
	options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
): Effect.Effect<OkfitRun, CommandFailedError | CommandOutputError, ChildProcessSpawner.ChildProcessSpawner> =>
	Run.collect(
		ChildProcess.setCwd(ChildProcess.make(process.execPath, [BIN, ...args], { env: options.env }), options.cwd),
	);
