import { resolve } from "node:path";
import type { Cause, PlatformError, Scope } from "effect";
import { Effect, Queue, Ref, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/** The built dev bin, resolved from this file's own location, never from cwd. */
export const MCP_BIN: string = resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"dist",
	"dev",
	"pkg",
	"bin",
	"okfit-mcp.js",
);

/** A live server process a test can write to while it runs. */
export interface McpProcess {
	/** JSON-encode one message and write it, newline-framed, to the child's stdin. */
	readonly send: (message: unknown) => Effect.Effect<void>;
	/** The next complete stdout line. */
	readonly nextLine: Effect.Effect<string>;
	/** Close the child's stdin, which is what should end the server's scope. */
	readonly closeStdin: Effect.Effect<void>;
	/**
	 * Resolves with the child's exit code.
	 *
	 * Deviation from the brief's literal `Effect.Effect<number>`: the
	 * verified `ChildProcessHandle.exitCode` (`unstable/process/ChildProcessSpawner.ts:89`)
	 * is `Effect.Effect<ExitCode, PlatformError.PlatformError>` — a branded
	 * `number` that can genuinely fail if the OS wait call itself errors.
	 * `ExitCode` is a `Brand.Branded<number, ...>`, structurally a `number`,
	 * so callers comparing it with `assert.strictEqual(code, 0)` are
	 * unaffected; the failure channel is kept honest rather than hidden
	 * behind a cast.
	 */
	readonly exitCode: Effect.Effect<number, PlatformError.PlatformError>;
	/** Everything written to stderr so far. */
	readonly stderrSoFar: Effect.Effect<string>;
}

/**
 * Spawn the built bin as a long-lived server.
 *
 * This is deliberately NOT `packages/cli/__test__/e2e/utils/okfit.ts` (J-12):
 * that helper's `collect` drains stdout, stderr and `exitCode` concurrently
 * TO COMPLETION, which is correct for a CLI that exits and never returns for
 * a server that waits on stdin. This helper keeps the same discipline --
 * `ChildProcess.make(process.execPath, [MCP_BIN], { env })` through
 * `ChildProcessSpawner`, explicit `env` with `extendEnv` never set,
 * concurrent draining inside one scope -- but exposes incremental send /
 * line-stream / closeStdin instead.
 *
 * `handle.stdin` (VERIFIED `unstable/process/ChildProcessSpawner.ts:106`) is
 * a `Sink.Sink<void, Uint8Array, never, PlatformError.PlatformError>`, not
 * something written to directly: an unbounded `Queue<Uint8Array, Cause.Done>`
 * is drained into it once, forked for the life of the scope, via
 * `Stream.run(Stream.fromQueue(queue), handle.stdin)`. `send` offers one
 * encoded, newline-terminated frame to that queue; `closeStdin` is
 * `Queue.end` (VERIFIED `Queue.ts:1004`), which fails the queue with
 * `Cause.Done` -- the signal `Stream.fromQueue` (VERIFIED `Stream.ts:1132`,
 * `Exclude<E, Cause.Done>`) treats as a graceful stream end, draining
 * whatever was already offered before ending the sink and, per
 * `StdinConfig.endOnDone`'s default of `true`
 * (`unstable/process/ChildProcess.ts:278`), closing the child's stdin fd.
 * `Queue.shutdown` was rejected: it interrupts takers immediately rather
 * than draining, which could truncate an in-flight write.
 *
 * @public
 */
export const spawnMcp = (
	env: Readonly<Record<string, string>>,
): Effect.Effect<McpProcess, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [MCP_BIN], { env }));

		const encoder = new TextEncoder();
		const stdin = yield* Queue.make<Uint8Array, Cause.Done>();
		yield* Stream.run(Stream.fromQueue(stdin), handle.stdin).pipe(Effect.forkScoped);

		const lines = yield* Queue.unbounded<string>();
		let pending = "";
		yield* Stream.decodeText(handle.stdout)
			.pipe(
				Stream.runForEach((text) =>
					Effect.gen(function* () {
						pending += text;
						let newline = pending.indexOf("\n");
						while (newline !== -1) {
							const line = pending.slice(0, newline);
							pending = pending.slice(newline + 1);
							if (line.length > 0) yield* Queue.offer(lines, line);
							newline = pending.indexOf("\n");
						}
					}),
				),
			)
			.pipe(Effect.forkScoped);

		const stderrRef = yield* Ref.make("");
		yield* Stream.decodeText(handle.stderr)
			.pipe(Stream.runForEach((text) => Ref.update(stderrRef, (current) => current + text)))
			.pipe(Effect.forkScoped);

		const send = (message: unknown): Effect.Effect<void> =>
			Queue.offer(stdin, encoder.encode(`${JSON.stringify(message)}\n`)).pipe(Effect.asVoid);

		return {
			send,
			nextLine: Queue.take(lines),
			closeStdin: Queue.end(stdin).pipe(Effect.asVoid),
			exitCode: handle.exitCode,
			stderrSoFar: Ref.get(stderrRef),
		};
	});
