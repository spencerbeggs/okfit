import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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

const CRLF = "\r\n";
const CRLFCRLF = "\r\n\r\n";
const CONTENT_LENGTH_LINE = /^Content-Length:\s*(\d+)$/i;
const CONTENT_TYPE_LINE = /^Content-Type:\s*\S.*$/i;

/**
 * Parses a frame header block -- the text before the blank line separating
 * it from the body -- into its declared body length, or `null` when the
 * block is not *exactly* a valid LSP header: one `Content-Length` line,
 * optionally one `Content-Type` line, and nothing else. Anchoring per-line
 * (rather than testing the whole block with a multiline `m`-flagged regex)
 * is the point: a leading blank line or a stray log line sharing the block
 * with a real header must fail to parse, not be silently absorbed into it.
 */
const parseHeader = (header: string): number | null => {
	const lines = header.split(CRLF).filter((line) => line.length > 0);
	let length: number | null = null;
	for (const line of lines) {
		const match = CONTENT_LENGTH_LINE.exec(line);
		if (match !== null) {
			if (length !== null) return null; // a duplicate Content-Length line is not a valid header either
			length = Number(match[1]);
			continue;
		}
		if (CONTENT_TYPE_LINE.test(line)) continue;
		return null;
	}
	return length;
};

/** The result of one {@link takeFrames} call. */
export interface TakeFramesResult {
	/** Every complete frame's body, decoded as UTF-8, in arrival order. */
	readonly frames: ReadonlyArray<string>;
	/** Whatever `buffer` did not consume, still as bytes: a partial trailing frame, or (when `malformed` is set) the unparsed residue starting at the bad header. */
	readonly rest: Buffer;
	/** The header block that failed to parse, or `null` when every header seen so far was valid. */
	readonly malformed: string | null;
}

/**
 * Extracts every complete `Content-Length` frame from the head of `buffer`,
 * stopping at the first partial trailing frame or unparseable header.
 * `Content-Length` counts bytes, so the scan runs over bytes and decodes a
 * body only once it is complete: counting decoded characters instead would
 * desync on the first non-ASCII character. Shared by {@link assertOnlyFrames}
 * (given a whole capture at once, so `rest` is only ever a partial trailing
 * frame or true residue) and `spawnLsp`'s stdout parser (given one chunk at a
 * time, `rest` carried into the next call as `pending`).
 *
 * @public
 */
export const takeFrames = (buffer: Buffer): TakeFramesResult => {
	const frames: Array<string> = [];
	let pending = buffer;
	while (true) {
		const headerEnd = pending.indexOf(CRLFCRLF);
		if (headerEnd === -1) break;
		const header = pending.subarray(0, headerEnd).toString("utf8");
		const length = parseHeader(header);
		if (length === null) return { frames, rest: pending, malformed: header };
		const bodyStart = headerEnd + CRLFCRLF.length;
		if (pending.length - bodyStart < length) break;
		frames.push(pending.subarray(bodyStart, bodyStart + length).toString("utf8"));
		pending = pending.subarray(bodyStart + length);
	}
	return { frames, rest: pending, malformed: null };
};

/** One `Content-Length` frame around `body`, the length counted in UTF-8 bytes. */
export const frameOf = (body: string): string => `Content-Length: ${Buffer.byteLength(body, "utf8")}${CRLFCRLF}${body}`;

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
	const { rest: restBytes, malformed } = takeFrames(Buffer.from(raw, "utf8"));
	const rest = restBytes.toString("utf8");
	if (malformed !== null) {
		assert.fail(`stdout carried a non-frame header: ${JSON.stringify(malformed)}`);
	}
	assert.ok(
		rest.length === 0 || "Content-Length:".startsWith(rest) || rest.startsWith("Content-Length:"),
		`stdout carried residue outside any frame: ${JSON.stringify(rest)}`,
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
 * `extraArgs` follow `--stdio` on the command line (for example
 * `--clientProcessId=<pid>`).
 *
 * @public
 */
export const spawnLsp = (
	env: Readonly<Record<string, string>>,
	extraArgs: ReadonlyArray<string> = [],
): Effect.Effect<LspProcess, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner.spawn(
			ChildProcess.make(process.execPath, [LSP_BIN, "--stdio", ...extraArgs], { env }),
		);

		const encoder = new TextEncoder();
		const stdin = yield* Queue.make<Uint8Array, Cause.Done>();
		yield* Stream.run(Stream.fromQueue(stdin), handle.stdin).pipe(Effect.forkScoped);

		const messages = yield* Queue.unbounded<unknown>();
		// Raw bytes, decoded only on read, so a multi-byte character split across two chunks survives.
		const rawRef = yield* Ref.make<ReadonlyArray<Uint8Array>>([]);
		let pending: Buffer = Buffer.alloc(0);
		yield* handle.stdout
			.pipe(
				Stream.runForEach((chunk) =>
					Effect.gen(function* () {
						yield* Ref.update(rawRef, (current) => [...current, chunk]);
						pending = Buffer.concat([pending, chunk]);
						const { frames, rest } = takeFrames(pending);
						pending = rest;
						yield* Effect.forEach(frames, (body) => Queue.offer(messages, JSON.parse(body) as unknown), {
							discard: true,
						});
					}),
				),
			)
			.pipe(Effect.forkScoped);

		const stderrRef = yield* Ref.make("");
		yield* Stream.decodeText(handle.stderr)
			.pipe(Stream.runForEach((text) => Ref.update(stderrRef, (current) => current + text)))
			.pipe(Effect.forkScoped);

		const send = (message: unknown): Effect.Effect<void> =>
			Queue.offer(stdin, encoder.encode(frameOf(JSON.stringify(message)))).pipe(Effect.asVoid);

		return {
			send,
			nextMessage: Queue.take(messages),
			closeStdin: Queue.end(stdin).pipe(Effect.asVoid),
			exitCode: handle.exitCode,
			stderrSoFar: Ref.get(stderrRef),
			rawStdoutSoFar: Effect.map(Ref.get(rawRef), (chunks) => Buffer.concat(chunks).toString("utf8")),
		};
	});
