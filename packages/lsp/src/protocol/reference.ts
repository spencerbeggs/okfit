import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { Duration, Exit, Fiber, Scope } from "effect";
import { Cause, Deferred, Effect, FiberSet, Option, Predicate } from "effect";
import type { Connection, WatchDog } from "vscode-languageserver";
import { createConnection as createServerConnection } from "vscode-languageserver";
import {
	ProposedFeatures,
	ResponseError,
	StreamMessageReader,
	StreamMessageWriter,
	createConnection,
	createProtocolConnection,
} from "vscode-languageserver/node";
import { LspError } from "../errors.js";
import type { ListenOutcome, LspTransportShape } from "./LspTransport.js";

/**
 * Options for {@link makeReferenceTransport}.
 *
 * @public
 */
export interface ReferenceTransportOptions {
	/** Omitted: the library reads `--stdio`/`--node-ipc`/`--socket`/`--pipe` from argv (main.ts). */
	readonly streams?: { readonly input: NodeJS.ReadableStream; readonly output: NodeJS.WritableStream };
	/**
	 * Overrides the two drain bounds documented on `SENTINEL_FALLBACK_TIMEOUT`
	 * and `WRITE_SETTLE_TIMEOUT`; both default to those constants. A test
	 * exercising the truncated-frame fallback passes a short `fallback` so the
	 * case does not have to wait out the production bound. `main.ts` passes
	 * nothing.
	 */
	readonly drain?: { readonly fallback?: Duration.Input; readonly writeSettle?: Duration.Input };
}

const INTERNAL_ERROR = -32603;

/** The JSON-RPC message a defect is answered with; the cause itself goes to the client's log channel. */
const INTERNAL_ERROR_MESSAGE = "Internal error";

/**
 * The reserved notification the transport appends to its own reader input when
 * the caller's input stream ends. Its params carry a token minted per
 * transport, so a client that sends this method itself is ignored.
 */
const INPUT_ENDED_METHOD = "okfit/$inputEnded";

/** One `Content-Length` frame of `INPUT_ENDED_METHOD` carrying `token`. */
const inputEndedFrame = (token: string): string => {
	const body = JSON.stringify({ jsonrpc: "2.0", method: INPUT_ENDED_METHOD, params: { token } });
	return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
};

/**
 * Default for `options.drain.fallback`: how long after the input ends the
 * transport waits for its sentinel to be dispatched before draining without
 * it. The sentinel is never dispatched when the input ended in the middle of
 * a frame: the reader counts the sentinel's bytes toward the truncated
 * frame. Decoding and queueing whatever was already buffered takes
 * milliseconds even for a large batch, so two seconds only delays
 * `"closed"` for a client that died mid-write, and never cuts short a batch
 * that is still being dispatched.
 */
const SENTINEL_FALLBACK_TIMEOUT: Duration.Input = "2 seconds";

/**
 * Default for `options.drain.writeSettle`: how long the `"closed"` drain
 * waits, once every handler has finished, for the library's outstanding
 * writes to complete. A peer that stops reading while holding the pipe open
 * never completes a write; `listen` still resolves.
 */
const WRITE_SETTLE_TIMEOUT: Duration.Input = "2 seconds";

type WriterMessage = Parameters<StreamMessageWriter["write"]>[0];

/**
 * The reference transport over `vscode-languageserver`.
 *
 * With `streams`, the connection is built on the library's server core with a
 * transport-owned watchdog, so neither the `exit` notification nor the input
 * stream ending ever calls `process.exit`: both resolve `listen` instead. The
 * library's own node entry calls `process.exit` from its watchdog after any
 * `onExit` handler, and on input `end`/`close` when handed raw streams, so it
 * is not used in this mode. The parent-process liveness poll the library runs
 * for `initialize`'s `processId` is not installed either; a vanished client
 * closes the input stream, which resolves `listen` with `"closed"`.
 *
 * The library decodes and dispatches buffered frames asynchronously, so the
 * input stream's `end` can arrive while messages it delivered are still
 * undecoded. The library's reader therefore reads a transport-owned
 * `PassThrough`, not the input stream: the input is piped into it without
 * ending it, and on the input's first `end` or `close` the transport writes
 * one frame of the reserved notification `okfit/$inputEnded` after
 * everything already piped, then ends it. The reader's decode queue and the
 * connection's message queue are both first in, first out, so that
 * notification is dispatched only after every earlier message has been
 * dispatched; an `exit` among them has already resolved `listen` with
 * `"exit"`. Its handler then waits for every handler fiber to finish, for
 * every earlier message's processing (a request's response write included)
 * and for every write the transport's writer has outstanding, and resolves
 * `listen` with `"closed"`. The write wait is bounded by
 * `WRITE_SETTLE_TIMEOUT`; the handler wait is not. The notification's params
 * carry a token minted per transport, and a copy sent by the client is
 * ignored. When the input ends in the middle of a frame the reader never
 * dispatches the sentinel, so `SENTINEL_FALLBACK_TIMEOUT` after the input
 * ends the same drain runs without it; the sentinel's arrival cancels that
 * fallback. The owned `PassThrough` does not emit `close`, so the connection
 * stays open, and a handler can still send, until the scope's finalizer
 * disposes it.
 *
 * Without `streams`, the library's node entry reads the connection kind from
 * argv and keeps its own exit behaviour: `exit` and input end terminate the
 * process after `listen`'s outcome is recorded. `main.ts` passes streams.
 *
 * Handlers run as fibers of a `FiberSet` in the caller's scope, with the
 * services and references in context when the transport was built, so a
 * handler sees the caller's logger, `LogToStderr` and tracer. When the scope
 * closes, in-flight handlers and any running drain are interrupted first, then
 * the input is unpiped, the reader's input ended, and the connection disposed.
 *
 * @public
 */
export const makeReferenceTransport = (
	options?: ReferenceTransportOptions,
): Effect.Effect<LspTransportShape, never, Scope.Scope> =>
	Effect.gen(function* () {
		const done = yield* Deferred.make<ListenOutcome>();
		let shutdownReceived = false;
		let finished = false;
		const finish = (reason: ListenOutcome["reason"]): void => {
			if (finished) return;
			finished = true;
			Deferred.doneUnsafe(done, Effect.succeed({ reason, shutdownReceived }));
		};

		/** Every message the connection is still processing, from dispatch until its handling (and any reply write) settles. */
		const messagesInFlight = new Set<Promise<void>>();
		/** Every write the transport's writer has started and not yet seen complete. */
		const writesInFlight = new Set<Promise<void>>();
		const track = (set: Set<Promise<void>>, promise: PromiseLike<unknown>): void => {
			const settled = Promise.resolve(promise).then(
				() => undefined,
				() => undefined,
			);
			set.add(settled);
			void settled.then(() => set.delete(settled));
		};

		const watchDog: WatchDog = {
			get shutdownReceived() {
				return shutdownReceived;
			},
			set shutdownReceived(value: boolean) {
				shutdownReceived = value;
			},
			initialize: () => {},
			exit: () => finish("exit"),
		};

		const streams = options?.streams;
		const sentinelFallbackTimeout = options?.drain?.fallback ?? SENTINEL_FALLBACK_TIMEOUT;
		const writeSettleTimeout = options?.drain?.writeSettle ?? WRITE_SETTLE_TIMEOUT;
		/* `emitClose: false`: the reader's `onClose` would mark the connection Closed before the drain runs, and a drained handler could no longer send. The finalizer's `dispose` closes it instead. */
		const readerInput = new PassThrough({ emitClose: false });
		const sentinelToken = randomUUID();
		let inputEnded = false;

		const connection: Connection = streams
			? createServerConnection(
					(logger) => {
						const writer = new StreamMessageWriter(streams.output);
						const write = writer.write.bind(writer);
						writer.write = (message: WriterMessage): Promise<void> => {
							const written = write(message);
							track(writesInFlight, written);
							return written;
						};
						const reader = new StreamMessageReader(readerInput);
						/* The reader re-arms a 10 s partial-message timer forever on a truncated frame and never clears it on dispose; nothing here listens for it. */
						reader.partialMessageTimeout = 0;
						return createProtocolConnection(reader, writer, logger, {
							messageStrategy: {
								handleMessage: (message, next) => {
									const result = next(message);
									if (result instanceof Promise) track(messagesInFlight, result);
									return result;
								},
							},
						});
					},
					watchDog,
					ProposedFeatures.all,
				)
			: createConnection(ProposedFeatures.all);

		let shutdownHandler: () => Effect.Effect<void> = () => Effect.void;
		connection.onShutdown(() => {
			shutdownReceived = true;
			return answer(shutdownHandler());
		});
		connection.onExit(() => finish("exit"));

		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				if (streams) {
					streams.input.removeListener("end", onInputEnded);
					streams.input.removeListener("close", onInputEnded);
					streams.input.unpipe(readerInput);
					if (!readerInput.writableEnded) readerInput.end();
				}
				connection.dispose();
			}),
		);

		/* Created after the dispose finalizer: scope finalizers run last-registered first, so handlers are interrupted before the connection is disposed. */
		const handlers = yield* FiberSet.make<unknown, unknown>();
		const runFork = yield* FiberSet.runtime(handlers)<never>();
		/* The drain runs outside `handlers`, so it can wait for that set to empty; its own set interrupts it when the scope closes. */
		const runDrain = yield* FiberSet.makeRuntime<never, void, never>();

		/** Waits for every handler, then for `messages` and the writer's outstanding writes (bounded), and resolves `"closed"`. */
		const drainThenClose = (messages: () => ReadonlyArray<Promise<void>>): Effect.Effect<void> =>
			Effect.gen(function* () {
				yield* FiberSet.awaitEmpty(handlers);
				yield* Effect.promise(() => Promise.all([...messages(), ...writesInFlight])).pipe(
					Effect.timeoutOption(writeSettleTimeout),
				);
				finish("closed");
			});

		let sentinelSeen = false;
		let fallback: Fiber.Fiber<void> | undefined;
		const onInputEnded = (): void => {
			if (inputEnded || !streams) return;
			inputEnded = true;
			streams.input.unpipe(readerInput);
			readerInput.end(inputEndedFrame(sentinelToken));
			fallback = runDrain(
				Effect.sleep(sentinelFallbackTimeout).pipe(
					Effect.andThen(
						Effect.suspend(() => (sentinelSeen ? Effect.void : drainThenClose(() => [...messagesInFlight]))),
					),
				),
			);
		};

		if (streams) {
			connection.onNotification(INPUT_ENDED_METHOD, (params: unknown) => {
				if (!inputEnded || !Predicate.hasProperty(params, "token") || params.token !== sentinelToken) return;
				sentinelSeen = true;
				fallback?.interruptUnsafe();
				if (finished) return;
				/* Taken synchronously: this notification's own processing is not yet in the set, and nothing is dispatched after it. */
				const earlierMessages = [...messagesInFlight];
				runDrain(drainThenClose(() => earlierMessages));
			});
			streams.input.pipe(readerInput, { end: false });
			streams.input.once("end", onInputEnded);
			streams.input.once("close", onInputEnded);
		}

		const run = <A, E>(effect: Effect.Effect<A, E>): Promise<Exit.Exit<A, E>> =>
			new Promise((resolve) => {
				/* runFork evaluates synchronously; yielding first means the set tracks the fiber before any handler code runs. */
				runFork(Effect.andThen(Effect.yieldNow, effect)).addObserver(resolve);
			});
		const logCause = (cause: Cause.Cause<unknown>): void => {
			if (Cause.hasInterruptsOnly(cause)) return;
			try {
				connection.console.error(Cause.pretty(cause));
			} catch {
				/* The connection is already disposed; there is no channel left to report on. */
			}
		};
		/** A request handler's result, or the `ResponseError` its promise rejects with. */
		const answer = <A>(effect: Effect.Effect<A, LspError>): Promise<A> =>
			run(effect).then((exit) => {
				if (exit._tag === "Success") return exit.value;
				const failure = Cause.findErrorOption(exit.cause);
				if (Option.isSome(failure)) throw new ResponseError(failure.value.code, failure.value.message);
				logCause(exit.cause);
				throw new ResponseError(INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE);
			});
		const report = (effect: Effect.Effect<void>): void => {
			void run(effect).then((exit) => {
				if (exit._tag === "Failure") logCause(exit.cause);
			});
		};

		let listening = false;

		const transport: LspTransportShape = {
			onInitialize: (handler) => Effect.sync(() => void connection.onInitialize((params) => answer(handler(params)))),
			onInitialized: (handler) => Effect.sync(() => void connection.onInitialized(() => report(handler()))),
			onShutdown: (handler) =>
				Effect.sync(() => {
					shutdownHandler = handler;
				}),
			onRequest: <P, R>(method: string, handler: (params: P) => Effect.Effect<R, LspError>) =>
				Effect.sync(() => void connection.onRequest(method, (params: P): Promise<unknown> => answer(handler(params)))),
			onNotification: <P>(method: string, handler: (params: P) => Effect.Effect<void>) =>
				Effect.sync(() => void connection.onNotification(method, (params: P) => report(handler(params)))),
			sendNotification: (method, params) =>
				Effect.tryPromise({
					try: () => connection.sendNotification(method, params),
					catch: (cause) => cause,
				}).pipe(Effect.catch(() => Effect.void)),
			sendRequest: <P, R>(method: string, params: P) =>
				Effect.tryPromise({
					try: () => connection.sendRequest<R>(method, params),
					catch: (cause) =>
						cause instanceof ResponseError
							? new LspError({ code: cause.code, message: cause.message })
							: new LspError({ code: INTERNAL_ERROR, message: String(cause) }),
				}),
			listen: Effect.suspend(() => {
				if (!listening) {
					listening = true;
					connection.listen();
				}
				return Deferred.await(done);
			}),
		};
		return transport;
	});
