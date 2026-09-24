import { Deferred, Effect, Ref } from "effect";
import type { LspTransportShape } from "../../src/protocol/LspTransport.js";

/** A notification recorded by {@link makeRecordingTransport} or {@link makeBlockingTransport}. */
export interface RecordedNotification {
	readonly method: string;
	readonly params: unknown;
}

/** A member that fails the test if a fake transport is asked to use it. */
export const die = (name: string) => (): Effect.Effect<never> =>
	Effect.die(`fake transport: ${name} is not used by this test`);

/** A transport whose `sendNotification` records every call; every other member dies if called. */
export const makeRecordingTransport = (): {
	readonly transport: LspTransportShape;
	readonly notifications: Array<RecordedNotification>;
} => {
	const notifications: Array<RecordedNotification> = [];
	const transport = {
		onInitialize: die("onInitialize"),
		onInitialized: die("onInitialized"),
		onShutdown: die("onShutdown"),
		onRequest: die("onRequest"),
		onNotification: die("onNotification"),
		sendNotification: (method: string, params: unknown) =>
			Effect.sync(() => void notifications.push({ method, params })),
		sendRequest: die("sendRequest"),
		listen: Effect.die("fake transport: listen is not used by this test"),
	} as unknown as LspTransportShape;
	return { transport, notifications };
};

/**
 * A transport whose `sendNotification` records every call like
 * {@link makeRecordingTransport}, except while `armed` is `true` a
 * `textDocument/publishDiagnostics` call for `blockUri` first resolves
 * `started` (so a test can await the moment the send is in flight,
 * independent of virtual-clock timing) and then awaits `gate` before
 * recording -- used to land an external interrupt (a rebuild's
 * `Scope.close`) squarely between a per-file publish step's send and its
 * `remember` update.
 */
export const makeBlockingTransport = (
	blockUri: string,
	armed: Ref.Ref<boolean>,
	started: Deferred.Deferred<void>,
	gate: Deferred.Deferred<void>,
): {
	readonly transport: LspTransportShape;
	readonly notifications: Array<RecordedNotification>;
} => {
	const notifications: Array<RecordedNotification> = [];
	const transport = {
		onInitialize: die("onInitialize"),
		onInitialized: die("onInitialized"),
		onShutdown: die("onShutdown"),
		onRequest: die("onRequest"),
		onNotification: die("onNotification"),
		sendNotification: (method: string, params: unknown) =>
			Effect.gen(function* () {
				const isBlockTarget =
					method === "textDocument/publishDiagnostics" && (params as { uri: string }).uri === blockUri;
				if (isBlockTarget && (yield* Ref.get(armed))) {
					yield* Deferred.succeed(started, undefined);
					yield* Deferred.await(gate);
				}
				notifications.push({ method, params });
			}),
		sendRequest: die("sendRequest"),
		listen: Effect.die("fake transport: listen is not used by this test"),
	} as unknown as LspTransportShape;
	return { transport, notifications };
};

/** A transport whose `onRequest` records each handler by method; every other member dies if called. */
export const makeCapturingTransport = (): {
	readonly transport: LspTransportShape;
	readonly call: <P, R>(method: string, params: P) => Effect.Effect<R>;
} => {
	const handlers = new Map<string, (params: unknown) => Effect.Effect<unknown>>();
	const transport = {
		onInitialize: die("onInitialize"),
		onInitialized: die("onInitialized"),
		onShutdown: die("onShutdown"),
		onRequest: (method: string, handler: (params: unknown) => Effect.Effect<unknown>) =>
			Effect.sync(() => void handlers.set(method, handler)),
		onNotification: die("onNotification"),
		sendNotification: die("sendNotification"),
		sendRequest: die("sendRequest"),
		listen: Effect.die("fake transport: listen is not used by this test"),
	} as unknown as LspTransportShape;
	const call = <P, R>(method: string, params: P): Effect.Effect<R> => {
		const handler = handlers.get(method);
		return handler === undefined
			? Effect.die(`no handler registered for ${method}`)
			: (handler(params) as Effect.Effect<R>);
	};
	return { transport, call };
};

/**
 * A transport combining {@link makeCapturingTransport}'s `onRequest` capture
 * with {@link makeRecordingTransport}'s `sendNotification` recording, for a
 * test that needs to both call a registered handler and observe the
 * notifications a warm-up (or any other side effect inside that handler)
 * sends along the way.
 */
export const makeCapturingRecordingTransport = (): {
	readonly transport: LspTransportShape;
	readonly call: <P, R>(method: string, params: P) => Effect.Effect<R>;
	readonly notifications: Array<RecordedNotification>;
} => {
	const handlers = new Map<string, (params: unknown) => Effect.Effect<unknown>>();
	const notifications: Array<RecordedNotification> = [];
	const transport = {
		onInitialize: die("onInitialize"),
		onInitialized: die("onInitialized"),
		onShutdown: die("onShutdown"),
		onRequest: (method: string, handler: (params: unknown) => Effect.Effect<unknown>) =>
			Effect.sync(() => void handlers.set(method, handler)),
		onNotification: die("onNotification"),
		sendNotification: (method: string, params: unknown) =>
			Effect.sync(() => void notifications.push({ method, params })),
		sendRequest: die("sendRequest"),
		listen: Effect.die("fake transport: listen is not used by this test"),
	} as unknown as LspTransportShape;
	const call = <P, R>(method: string, params: P): Effect.Effect<R> => {
		const handler = handlers.get(method);
		return handler === undefined
			? Effect.die(`no handler registered for ${method}`)
			: (handler(params) as Effect.Effect<R>);
	};
	return { transport, call, notifications };
};
