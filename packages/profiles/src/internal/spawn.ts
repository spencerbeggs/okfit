// The collector GitHistory.layer runs git through (P-1, P-36). A copy of @effected/git's private
// runCollected discipline (effected-git-0-10-0.md section 2.1): one spawn inside a scope, stdout, stderr
// and the exit code collected CONCURRENTLY. Unbounded concurrency is load-bearing: sequential collection
// deadlocks once a real OS pipe buffer fills. Not exported from the barrel; the integration fixtures carry
// their own collector in __test__/utils/git.ts (P-36).

import type { PlatformError } from "effect"; // EF/index.ts:402
import { Effect, Stream } from "effect"; // EF/index.ts:152, :587
import type { ChildProcess } from "effect/unstable/process"; // EF/unstable/process/index.ts:10
import { ChildProcessSpawner } from "effect/unstable/process"; // EF/unstable/process/index.ts:15; service :252

/** Everything one git run produced. `exitCode` is the handle's branded `ExitCode` widened to `number`. */
export interface Collected {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

/**
 * Spawns `command` and collects both output streams and the exit code together. Fails only with the
 * spawn-level `PlatformError`; a non-zero exit is data in `Collected`, classified by the caller.
 */
export const runCollected = (
	command: ChildProcess.Command,
): Effect.Effect<Collected, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.scoped(
		// EF/Effect.ts:6436
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(command); // EF/unstable/process/ChildProcessSpawner.ts:252
			const [stdout, stderr, exitCode] = yield* Effect.all(
				[
					Stream.mkString(Stream.decodeText(handle.stdout)), // EF/Stream.ts:10831, :9197; handle.stdout :115
					Stream.mkString(Stream.decodeText(handle.stderr)), // handle.stderr :124
					handle.exitCode, // :89
				],
				{ concurrency: "unbounded" }, // EF/Effect.ts:494
			);
			return { stdout, stderr, exitCode };
		}),
	);
