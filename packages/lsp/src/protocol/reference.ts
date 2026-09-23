import type { Exit, Scope } from "effect";
import { Cause, Deferred, Effect, Option } from "effect";
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

/** An `Exit` as the value a library request handler resolves with, or the `ResponseError` it throws. */
const settle = <A>(exit: Exit.Exit<A, LspError>): A => {
	if (exit._tag === "Success") return exit.value;
	const failure = Cause.findErrorOption(exit.cause);
	if (Option.isSome(failure)) throw new ResponseError(failure.value.code, failure.value.message);
	throw new ResponseError(INTERNAL_ERROR, Cause.pretty(exit.cause));
};

const answer = <A>(effect: Effect.Effect<A, LspError>): Promise<A> => Effect.runPromiseExit(effect).then(settle);

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
 * Without `streams`, the library's node entry reads the connection kind from
 * argv and keeps its own exit behaviour: `exit` and input end terminate the
 * process after `listen`'s outcome is recorded. `main.ts` passes streams.
 *
 * The connection is disposed when the scope closes.
 *
 * @public
 */
export const makeReferenceTransport = (
	options?: ReferenceTransportOptions,
): Effect.Effect<LspTransportShape, never, Scope.Scope> =>
	Effect.gen(function* () {
		const done = yield* Deferred.make<ListenOutcome>();
		let shutdownReceived = false;
		const finish = (reason: ListenOutcome["reason"]): void => {
			Deferred.doneUnsafe(done, Effect.succeed({ reason, shutdownReceived }));
		};

		const streams = options?.streams;
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

		const onInputEnded = (): void => finish("closed");
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

		const report = (effect: Effect.Effect<void>): void => {
			void Effect.runPromiseExit(effect).then((exit) => {
				if (exit._tag === "Failure") connection.console.error(Cause.pretty(exit.cause));
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
