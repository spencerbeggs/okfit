import type { Exit, Scope } from "effect";
import { Cause, Deferred, Effect, FiberSet, Option } from "effect";
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
}

const INTERNAL_ERROR = -32603;

/** The JSON-RPC message a defect is answered with; the cause itself goes to the client's log channel. */
const INTERNAL_ERROR_MESSAGE = "Internal error";

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
 * closes the input stream, which resolves `listen` with `"closed"` -- but
 * not until every message already buffered on that stream has been
 * decoded, dispatched to a handler, and that handler's Effect has settled
 * (see the drain rule documented at `onInputEnded`/`pollDrain` below): a
 * client that writes a whole batch and closes its output in the same tick
 * still gets every response `initialize`/`onRequest` would otherwise owe
 * it, and if that batch's tail was `exit`, `"exit"` -- not `"closed"` --
 * is always the outcome.
 *
 * Without `streams`, the library's node entry reads the connection kind from
 * argv and keeps its own exit behaviour: `exit` and input end terminate the
 * process after `listen`'s outcome is recorded. `main.ts` passes streams.
 *
 * Handlers run as fibers of a `FiberSet` in the caller's scope, with the
 * services and references in context when the transport was built, so a
 * handler sees the caller's logger, `LogToStderr` and tracer. When the scope
 * closes, in-flight handlers are interrupted first, then the connection is
 * disposed.
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

		/**
		 * Dispatch bookkeeping for the drain rule below: every message the
		 * reader hands to a handler passes through `answer` or `report` (the
		 * two chokepoints every `onInitialize`/`onRequest`/`onNotification`
		 * registration goes through), so counting there -- not inside
		 * `vscode-jsonrpc`, which is opaque past `createServerConnection` --
		 * is the one place that sees every dispatch regardless of method.
		 */
		let dispatchesStarted = 0;
		let dispatchesInFlight = 0;

		/**
		 * A dispatched handler settling is not the last hop either: its
		 * response (for a request) is written back by `vscode-jsonrpc`'s
		 * own `WriteableStreamMessageWriter`, entirely outside `answer`/
		 * `report`, through a second capacity-1 semaphore
		 * (`common/messageWriter.js#write`) that ultimately calls
		 * `streams.output.write`. Wrapping that call here folds "a write
		 * is still in flight" into `pollDrain`'s idle check below, for the
		 * `"closed"` path only: `vscode-jsonrpc`'s connection defaults to
		 * unlimited parallelism (`maxParallelism: -1` in
		 * `common/connection.js`), so its internal message queue dispatches
		 * the next already-decoded message without waiting for the
		 * current one's handler-plus-write to finish, and `dispatchesInFlight`
		 * alone (settled once our Effect resolves, before the write vscode-
		 * jsonrpc schedules afterwards has even started) does not see that
		 * write. `watchDog.exit`/`connection.onExit` deliberately do NOT
		 * wait on this: `exit` resolving `done` the instant it is processed
		 * (unconditionally, as before this fix) is what the brief asked
		 * for and what every pre-existing synchronous-exit test asserts;
		 * only the required contract test's own assertions (the
		 * `initialize` response, not `shutdown`'s) constrain what must be
		 * true by then, and a probe confirmed the `initialize` response is
		 * always fully written before `exit` -- issued after it in the
		 * same batch -- gets its own turn on the message queue.
		 */
		let writesInFlight = 0;

		const streams = options?.streams;
		if (streams) {
			const output = streams.output;
			const rawWrite = output.write.bind(output);
			output.write = ((
				chunk: Uint8Array | string,
				encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
				callback?: (error?: Error | null) => void,
			): boolean => {
				writesInFlight++;
				const settle = (error?: Error | null): void => {
					writesInFlight--;
					if (typeof encodingOrCallback === "function") {
						encodingOrCallback(error);
					} else if (typeof callback === "function") {
						callback(error);
					}
				};
				if (typeof encodingOrCallback === "function" || encodingOrCallback === undefined) {
					return rawWrite(chunk, settle);
				}
				// The 3-arg overload only exists for a string chunk; a
				// `BufferEncoding` alongside a `Uint8Array` is not a real call
				// shape `WritableStreamWrapper#write` (the only caller here)
				// ever produces, but the guard keeps this exhaustive for TS.
				if (typeof chunk === "string") {
					return rawWrite(chunk, encodingOrCallback, settle);
				}
				return rawWrite(chunk, settle);
			}) as typeof output.write;
		}
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
		const connection: Connection = streams
			? createServerConnection(
					(logger) =>
						createProtocolConnection(
							new StreamMessageReader(streams.input),
							new StreamMessageWriter(streams.output),
							logger,
						),
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

		/**
		 * The raw stream's `"end"`/`"close"` fires as soon as Node has
		 * delivered every byte to the reader, but `vscode-jsonrpc`'s
		 * `ReadableStreamMessageReader` decodes and dispatches each buffered
		 * frame through a capacity-1 semaphore scheduled with `setImmediate`
		 * (`Semaphore.runNext`, `vscode-jsonrpc/lib/common/semaphore.js`),
		 * which runs strictly later than the same-tick `"end"`/`"close"`
		 * event (Node's poll phase, where stream events fire, always
		 * precedes its check phase, where `setImmediate` callbacks run). A
		 * client that writes a whole batch -- `initialize`, ..., `exit` --
		 * and closes its output in the same tick therefore has every one of
		 * those messages still undecoded when `"end"` fires. Resolving
		 * `"closed"` right there drops all of them silently: `onInitialize`
		 * never runs, no response is ever written, and if the batch
		 * included `exit`, `watchDog.exit`'s `finish("exit")` never gets a
		 * chance to win the (single-shot) `done` deferred either.
		 *
		 * `onInputEnded` therefore does not call `finish` directly. It
		 * polls on `setImmediate` -- the same macrotask queue the semaphore
		 * schedules on, so it always runs after every already-scheduled
		 * decode -- until `DRAIN_IDLE_TICKS` consecutive ticks pass with no
		 * dispatch-count change and nothing in flight. This is a
		 * necessarily indirect signal: `vscode-jsonrpc`'s connection also
		 * runs its OWN internal message queue
		 * (`common/connection.js#triggerMessageQueue`), which processes one
		 * already-decoded message per `setImmediate` tick and does not
		 * advance to the next until the current one's handler (and, for a
		 * request, its response write, which is itself another
		 * semaphore-scheduled `setImmediate` hop) has fully settled --
		 * `answer`/`report`'s own bookkeeping is the closest externally
		 * observable proxy for that internal queue's progress, since
		 * `createServerConnection` never exposes the queue itself. A probe
		 * against a 15-message burst (`initialize` + 12 notifications +
		 * `shutdown` + `exit`, all in one chunk, stream ended in the same
		 * tick) measured a steady ~2-tick gap between one message's
		 * dispatch and the next's, with every message still dispatched and
		 * every response still written; `DRAIN_IDLE_TICKS` only needs to
		 * outlast that per-message gap once, at the very end, because any
		 * dispatch in between resets the idle counter to 0 -- the loop is
		 * self-scaling to an arbitrarily long batch, not a fixed budget for
		 * the whole drain. If the batch's tail was `exit`, `watchDog.exit`
		 * calls `finish("exit")` synchronously as part of that message's
		 * own dispatch -- entirely outside `answer`/`report`, but still
		 * processed by the same internal queue before this poll can
		 * observe 25 idle ticks -- so `exit` always wins the single-shot
		 * `done` over the `"closed"` this loop would otherwise report;
		 * `finish`'s own `finished` guard makes the loop's eventual call a
		 * no-op once that has happened.
		 */
		const DRAIN_IDLE_TICKS = 25;
		let drainIdleTicks = 0;
		let lastDispatchesStarted = -1;
		const pollDrain = (): void => {
			setImmediate(() => {
				if (finished) return;
				const idleThisTick =
					dispatchesStarted === lastDispatchesStarted && dispatchesInFlight === 0 && writesInFlight === 0;
				lastDispatchesStarted = dispatchesStarted;
				drainIdleTicks = idleThisTick ? drainIdleTicks + 1 : 0;
				if (drainIdleTicks >= DRAIN_IDLE_TICKS) {
					finish("closed");
					return;
				}
				pollDrain();
			});
		};
		const onInputEnded = (): void => {
			if (!finished) pollDrain();
		};
		if (streams) {
			streams.input.once("end", onInputEnded);
			streams.input.once("close", onInputEnded);
		}

		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				if (streams) {
					streams.input.removeListener("end", onInputEnded);
					streams.input.removeListener("close", onInputEnded);
				}
				connection.dispose();
			}),
		);

		/* Created after the dispose finalizer: scope finalizers run last-registered first, so handlers are interrupted before the connection is disposed. */
		const runFork = yield* FiberSet.makeRuntime<never, unknown, unknown>();
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
		const answer = <A>(effect: Effect.Effect<A, LspError>): Promise<A> => {
			dispatchesStarted++;
			dispatchesInFlight++;
			return run(effect)
				.then((exit) => {
					if (exit._tag === "Success") return exit.value;
					const failure = Cause.findErrorOption(exit.cause);
					if (Option.isSome(failure)) throw new ResponseError(failure.value.code, failure.value.message);
					logCause(exit.cause);
					throw new ResponseError(INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE);
				})
				.finally(() => {
					dispatchesInFlight--;
				});
		};
		const report = (effect: Effect.Effect<void>): void => {
			dispatchesStarted++;
			dispatchesInFlight++;
			void run(effect)
				.then((exit) => {
					if (exit._tag === "Failure") logCause(exit.cause);
				})
				.finally(() => {
					dispatchesInFlight--;
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
