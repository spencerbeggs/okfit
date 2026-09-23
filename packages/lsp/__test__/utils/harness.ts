import { PassThrough } from "node:stream";
import type { Duration, Scope } from "effect";
import { Effect, Queue } from "effect";
import type { MessageConnection } from "vscode-jsonrpc/node";
import { StreamMessageReader, StreamMessageWriter, createMessageConnection } from "vscode-jsonrpc/node";
import type { LspTransportShape } from "../../src/protocol/LspTransport.js";
import { makeReferenceTransport } from "../../src/protocol/reference.js";

/** One published `textDocument/publishDiagnostics` payload, as JSON. */
export interface Published {
	readonly uri: string;
	readonly diagnostics: ReadonlyArray<{
		readonly range: {
			readonly start: { readonly line: number; readonly character: number };
			readonly end: { readonly line: number; readonly character: number };
		};
		readonly severity?: number;
		readonly code?: string | number;
		readonly source?: string;
		readonly message: string;
		readonly data?: unknown;
	}>;
}

export interface Harness {
	readonly transport: LspTransportShape;
	readonly client: MessageConnection;
	/** Next publishDiagnostics notification the client received; fails after `timeout`. */
	readonly nextPublish: (timeout?: Duration.Input) => Effect.Effect<Published, "no publish">;
	/** Every publish received so far, drained. */
	readonly drainPublished: Effect.Effect<ReadonlyArray<Published>>;
	readonly closeClientOutput: Effect.Effect<void>;
}

export const makeHarness: Effect.Effect<Harness, never, Scope.Scope> = Effect.gen(function* () {
	const clientToServer = new PassThrough();
	const serverToClient = new PassThrough();
	const transport = yield* makeReferenceTransport({ streams: { input: clientToServer, output: serverToClient } });
	const client = createMessageConnection(
		new StreamMessageReader(serverToClient),
		new StreamMessageWriter(clientToServer),
	);
	const published = yield* Queue.unbounded<Published>();
	client.onNotification("textDocument/publishDiagnostics", (params: Published) => {
		Effect.runSync(Queue.offer(published, params));
	});
	client.listen();
	yield* Effect.addFinalizer(() => Effect.sync(() => client.dispose()));
	const nextPublish = (timeout: Duration.Input = "5 seconds") =>
		Queue.take(published).pipe(
			Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.fail("no publish" as const) }),
		);
	const drainPublished = Effect.gen(function* () {
		const items: Array<Published> = [];
		while (true) {
			const next = yield* Queue.take(published).pipe(
				Effect.timeoutOrElse({ duration: "50 millis", orElse: () => Effect.succeed(undefined) }),
			);
			if (next === undefined) return items;
			items.push(next);
		}
	});
	const closeClientOutput = Effect.sync(() => clientToServer.end());
	return { transport, client, nextPublish, drainPublished, closeClientOutput };
});

/** `client.sendRequest` as an Effect. */
export const request = <R>(client: MessageConnection, method: string, params: unknown): Effect.Effect<R> =>
	Effect.promise(() => client.sendRequest(method, params) as Promise<R>);

/** `client.sendNotification` as an Effect. */
export const notify = (client: MessageConnection, method: string, params: unknown): Effect.Effect<void> =>
	Effect.promise(() => client.sendNotification(method, params));
