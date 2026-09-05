import { resolve } from "node:path";
import type { PlatformError } from "effect";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/** The built dev bin, resolved from this file's own location (contract section 6.3). */
export const BIN: string = resolve(import.meta.dirname, "..", "..", "..", "dist", "dev", "pkg", "bin", "okfit.js");

/** Everything one `okfit` run produced. */
export interface OkfitRun {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

/**
 * One spawn, stdout/stderr/exit code collected CONCURRENTLY inside one
 * scope — the same discipline as `packages/profiles/src/internal/spawn.ts`
 * and `packages/profiles/__test__/utils/git.ts`'s `runCollected`: sequential
 * collection deadlocks once a real OS pipe buffer fills.
 */
const collect = (
	command: ChildProcess.Command,
): Effect.Effect<OkfitRun, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(command);
			const [stdout, stderr, exitCode] = yield* Effect.all(
				[
					Stream.mkString(Stream.decodeText(handle.stdout)),
					Stream.mkString(Stream.decodeText(handle.stderr)),
					handle.exitCode,
				],
				{ concurrency: "unbounded" },
			);
			return { stdout, stderr, exitCode };
		}),
	);

/**
 * One spawn of the built bin (K-43): `ChildProcess.make(process.execPath,
 * [BIN, ...args], { env })` through `ChildProcessSpawner`, `env` explicit and
 * `extendEnv` never set — `PATH` passed through, `HOME` and all four
 * `XDG_*` variables pointed at per-test temp directories (a `Sandbox` from
 * `fixtures.ts`), `NO_COLOR=1`, and `OKFIT_NOW` when a test needs a fixed
 * clock.
 *
 * A non-zero exit is DATA, never a failure: `1`, `2`, `3` and `64` are
 * frequently the thing under test. The error channel is `PlatformError`,
 * which covers only a spawn that never started.
 *
 * @public
 */
export const runOkfit = (
	args: ReadonlyArray<string>,
	options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> },
): Effect.Effect<OkfitRun, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
	collect(ChildProcess.setCwd(ChildProcess.make(process.execPath, [BIN, ...args], { env: options.env }), options.cwd));
