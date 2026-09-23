import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Cause, PlatformError, Scope } from "effect";
import { Effect, Queue, Ref, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/** The built dev bin, resolved from this file's own location, never from cwd. */
export const LSP_BIN: string = resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"dist",
	"dev",
	"pkg",
	"bin",
	"okfit-lsp.js",
);

const CRLFCRLF = "\r\n\r\n";
const CONTENT_LENGTH = /^Content-Length:\s*(\d+)\s*$/im;

/** A live LSP server process a test can write to while it runs, framed with `Content-Length`. */
export interface LspProcess {
	/** JSON-encode one message and write it, `Content-Length`-framed, to the child's stdin. */
	readonly send: (message: unknown) => Effect.Effect<void>;
	/** The next complete stdout frame, parsed as JSON. */
	readonly nextMessage: Effect.Effect<unknown>;
	/** Close the child's stdin, which is what should end the server's scope. */
	readonly closeStdin: Effect.Effect<void>;
	/** Resolves with the child's exit code. See `mcpProcess.ts#McpProcess.exitCode` for the branded-`number` deviation this mirrors. */
	readonly exitCode: Effect.Effect<number, PlatformError.PlatformError>;
	/** Everything written to stderr so far. */
	readonly stderrSoFar: Effect.Effect<string>;
	/** Everything written to stdout so far, as raw text -- every frame's header and body, undecoded. */
	readonly rawStdoutSoFar: Effect.Effect<string>;
}

/**
 * Asserts that every byte of `raw` was consumed by complete `Content-Length`
 * frames, save at most a partial trailing frame (an in-flight header or a
 * body still arriving). Any other residue -- a stray log line, a header that
 * does not parse -- fails the assertion, which is the point: this is what
 * proves stdout carries nothing but the wire protocol (`main.ts`'s
 * `LogToStderr` wiring).
 *
 * @public
 */
export const assertOnlyFrames = (raw: string): void => {
	let pending = raw;
	while (true) {
		const headerEnd = pending.indexOf(CRLFCRLF);
		if (headerEnd === -1) break;
		const header = pending.slice(0, headerEnd);
		const match = CONTENT_LENGTH.exec(header);
		assert.ok(match !== null, `stdout carried a non-frame header: ${JSON.stringify(header)}`);
		const length = Number(match[1]);
		const bodyStart = headerEnd + CRLFCRLF.length;
		if (pending.length - bodyStart < length) {
			// A partial trailing frame: the header is complete but the body has not fully arrived yet.
			return;
		}
		pending = pending.slice(bodyStart + length);
	}
	assert.ok(
		pending.length === 0 || "Content-Length:".startsWith(pending) || pending.startsWith("Content-Length:"),
		`stdout carried residue outside any frame: ${JSON.stringify(pending)}`,
	);
};

/**
 * Spawn the built LSP bin as a long-lived server with `--stdio` (accepted
 * and ignored -- `main.ts` passes `process.stdin`/`process.stdout`
 * explicitly, see `protocol/reference.ts`'s TSDoc), Content-Length framed.
 *
 * Mirrors `packages/mcp/__test__/e2e/utils/mcpProcess.ts#spawnMcp` --
 * `ChildProcess.make(process.execPath, [LSP_BIN, "--stdio"], { env })`
 * through `ChildProcessSpawner`, explicit `env`, concurrent draining inside
 * one scope -- but frames stdout on `Content-Length` instead of newlines
 * and additionally records the raw, undecoded stdout text so a test can
 * prove nothing but frames crossed the wire (`assertOnlyFrames`).
 *
 * @public
 */
export const spawnLsp = (
	env: Readonly<Record<string, string>>,
): Effect.Effect<LspProcess, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [LSP_BIN, "--stdio"], { env }));

		const encoder = new TextEncoder();
		const stdin = yield* Queue.make<Uint8Array, Cause.Done>();
		yield* Stream.run(Stream.fromQueue(stdin), handle.stdin).pipe(Effect.forkScoped);

		const messages = yield* Queue.unbounded<unknown>();
		const rawRef = yield* Ref.make("");
		let pending = "";
		yield* Stream.decodeText(handle.stdout)
			.pipe(
				Stream.runForEach((text) =>
					Effect.gen(function* () {
						yield* Ref.update(rawRef, (current) => current + text);
						pending += text;
						while (true) {
							const headerEnd = pending.indexOf(CRLFCRLF);
							if (headerEnd === -1) break;
							const header = pending.slice(0, headerEnd);
							const match = CONTENT_LENGTH.exec(header);
							if (match === null) break;
							const length = Number(match[1]);
							const bodyStart = headerEnd + CRLFCRLF.length;
							if (pending.length - bodyStart < length) break;
							const body = pending.slice(bodyStart, bodyStart + length);
							pending = pending.slice(bodyStart + length);
							yield* Queue.offer(messages, JSON.parse(body) as unknown);
						}
					}),
				),
			)
			.pipe(Effect.forkScoped);

		const stderrRef = yield* Ref.make("");
		yield* Stream.decodeText(handle.stderr)
			.pipe(Stream.runForEach((text) => Ref.update(stderrRef, (current) => current + text)))
			.pipe(Effect.forkScoped);

		const send = (message: unknown): Effect.Effect<void> => {
			const body = JSON.stringify(message);
			const frame = `Content-Length: ${body.length}${CRLFCRLF}${body}`;
			return Queue.offer(stdin, encoder.encode(frame)).pipe(Effect.asVoid);
		};

		return {
			send,
			nextMessage: Queue.take(messages),
			closeStdin: Queue.end(stdin).pipe(Effect.asVoid),
			exitCode: handle.exitCode,
			stderrSoFar: Ref.get(stderrRef),
			rawStdoutSoFar: Ref.get(rawRef),
		};
	});
