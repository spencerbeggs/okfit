import { PassThrough } from "node:stream";
import { assert, describe, it } from "@effect/vitest";
import type { Duration } from "effect";
import { Deferred, Effect, Fiber, Option, References } from "effect";
import { LspError } from "../../src/errors.js";
import type { ReferenceTransportOptions } from "../../src/protocol/reference.js";
import { makeReferenceTransport } from "../../src/protocol/reference.js";
import { makeHarness, notify, request } from "../utils/harness.js";

/** One framed JSON-RPC message, as a client writes it to the server's input. */
const frame = (message: unknown): string => {
	const body = JSON.stringify(message);
	return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
};

const initializeFrame = frame({
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: { processId: null, rootUri: null, capabilities: {} },
});

const withListenTimeout = <A, E, R>(self: Effect.Effect<A, E, R>, duration: Duration.Input = "2 seconds") =>
	self.pipe(Effect.timeoutOrElse({ duration, orElse: () => Effect.fail("listen never resolved" as const) }));

/**
 * A reference transport over raw in-memory streams, for tests that must write
 * a whole batch as one chunk and end the input in the same tick (the harness's
 * `MessageConnection` frames and sends one message at a time).
 */
const makeRawTransport = (drain?: ReferenceTransportOptions["drain"]) =>
	Effect.gen(function* () {
		const input = new PassThrough();
		const serverToClient = new PassThrough();
		let written = "";
		serverToClient.on("data", (chunk: Buffer) => {
			written += chunk.toString("utf8");
		});
		const transport = yield* makeReferenceTransport({
			streams: { input, output: serverToClient },
			...(drain === undefined ? {} : { drain }),
		});
		return { input, output: { text: () => written }, transport };
	});

describe("ReferenceTransport", () => {
	it.effect("initialize runs the registered handler and returns its result", () =>
		Effect.gen(function* () {
			const { transport, client } = yield* makeHarness;
			yield* transport.onInitialize((params) =>
				Effect.succeed({
					capabilities: {},
					serverInfo: { name: `saw ${params.workspaceFolders?.length ?? 0} folders`, version: "0" },
				}),
			);
			const listening = yield* Effect.forkChild(transport.listen);
			const result = yield* request<{ readonly serverInfo: { readonly name: string } }>(client, "initialize", {
				processId: null,
				rootUri: null,
				capabilities: {},
				workspaceFolders: [{ uri: "file:///w", name: "w" }],
			});
			assert.strictEqual(result.serverInfo.name, "saw 1 folders");
			yield* notify(client, "exit", null);
			const outcome = yield* Fiber.join(listening);
			assert.deepStrictEqual(outcome, { reason: "exit", shutdownReceived: false });
		}).pipe(Effect.scoped),
	);

	it.effect("a failing request handler surfaces as a JSON-RPC error with the LspError code", () =>
		Effect.gen(function* () {
			const { transport, client } = yield* makeHarness;
			yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
			yield* transport.onRequest("okfit/boom", () => Effect.fail(new LspError({ code: -32803, message: "boom" })));
			yield* Effect.forkChild(transport.listen);
			yield* request(client, "initialize", { processId: null, rootUri: null, capabilities: {} });
			const failure = yield* Effect.tryPromise({
				try: () => client.sendRequest("okfit/boom", {}),
				catch: (error) => error as { readonly code: number; readonly message: string },
			}).pipe(Effect.flip);
			assert.strictEqual(failure.code, -32803);
			assert.strictEqual(failure.message, "boom");
		}).pipe(Effect.scoped),
	);

	it.effect("notifications flow both ways", () =>
		Effect.gen(function* () {
			const { transport, client } = yield* makeHarness;
			const seen = yield* Deferred.make<string>();
			yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
			yield* transport.onNotification<{ readonly text: string }>("okfit/ping", (params) =>
				Deferred.succeed(seen, params.text).pipe(Effect.asVoid),
			);
			yield* Effect.forkChild(transport.listen);
			yield* request(client, "initialize", { processId: null, rootUri: null, capabilities: {} });
			yield* notify(client, "okfit/ping", { text: "hello" });
			assert.strictEqual(yield* Deferred.await(seen), "hello");
			const got = yield* Deferred.make<string>();
			client.onNotification("okfit/pong", (params: { readonly text: string }) => {
				Effect.runSync(Deferred.succeed(got, params.text));
			});
			yield* transport.sendNotification("okfit/pong", { text: "back" });
			assert.strictEqual(yield* Deferred.await(got), "back");
		}).pipe(Effect.scoped),
	);

	it.effect("shutdown then exit resolves listen with shutdownReceived: true, and the process is still alive", () =>
		Effect.gen(function* () {
			const { transport, client } = yield* makeHarness;
			yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
			const listening = yield* Effect.forkChild(transport.listen);
			yield* request(client, "initialize", { processId: null, rootUri: null, capabilities: {} });
			yield* request(client, "shutdown", null);
			yield* notify(client, "exit", null);
			assert.deepStrictEqual(yield* Fiber.join(listening), { reason: "exit", shutdownReceived: true });
		}).pipe(Effect.scoped),
	);

	it.live("the client closing its output resolves listen with reason: closed", () =>
		Effect.gen(function* () {
			const { transport, client, closeClientOutput } = yield* makeHarness;
			yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
			const listening = yield* Effect.forkChild(transport.listen);
			yield* request(client, "initialize", { processId: null, rootUri: null, capabilities: {} });
			yield* closeClientOutput;
			const outcome = yield* Fiber.join(listening).pipe(
				Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("listen never resolved" as const) }),
			);
			assert.deepStrictEqual(outcome, { reason: "closed", shutdownReceived: false });
		}).pipe(Effect.scoped),
	);

	it.live(
		"a client that writes initialize, initialized, shutdown and exit as one chunk and ends its output in the same tick gets the initialize response, and listen resolves exit with shutdownReceived: true",
		() =>
			Effect.gen(function* () {
				const { input, output, transport } = yield* makeRawTransport();
				let initializeCalled = false;
				let shutdownCalled = false;
				yield* transport.onInitialize(() => {
					initializeCalled = true;
					return Effect.succeed({ capabilities: {} });
				});
				yield* transport.onShutdown(() => {
					shutdownCalled = true;
					return Effect.void;
				});
				const listening = yield* Effect.forkChild(transport.listen);
				yield* Effect.sync(() =>
					input.end(
						[
							initializeFrame,
							frame({ jsonrpc: "2.0", method: "initialized", params: {} }),
							frame({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null }),
							frame({ jsonrpc: "2.0", method: "exit", params: null }),
						].join(""),
					),
				);
				const outcome = yield* Fiber.join(listening).pipe(withListenTimeout);
				assert.isTrue(initializeCalled, "onInitialize should have been dispatched");
				assert.isTrue(shutdownCalled, "onShutdown should have been dispatched");
				assert.include(output.text(), '"id":1', "the initialize response should have been written");
				assert.deepStrictEqual(outcome, { reason: "exit", shutdownReceived: true });
			}).pipe(Effect.scoped),
	);

	it.live(
		"a one-chunk batch of 30 notifications with no handler between initialize and shutdown/exit, ended and closed in the same tick, still resolves exit with shutdownReceived: true",
		() =>
			Effect.gen(function* () {
				const { input, transport } = yield* makeRawTransport();
				let shutdownCalled = false;
				yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
				yield* transport.onShutdown(() => {
					shutdownCalled = true;
					return Effect.void;
				});
				const listening = yield* Effect.forkChild(transport.listen);
				const unhandled = Array.from({ length: 30 }, (_, index) =>
					index % 2 === 0
						? frame({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 10_000 + index } })
						: frame({ jsonrpc: "2.0", method: "workspace/didChangeConfiguration", params: { settings: {} } }),
				);
				// A default PassThrough auto-destroys after `end`, so the input emits both `end` and `close`.
				yield* Effect.sync(() =>
					input.end(
						[
							initializeFrame,
							...unhandled,
							frame({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null }),
							frame({ jsonrpc: "2.0", method: "exit", params: null }),
						].join(""),
					),
				);
				const outcome = yield* Fiber.join(listening).pipe(withListenTimeout);
				assert.isTrue(shutdownCalled, "onShutdown should have been dispatched");
				assert.deepStrictEqual(outcome, { reason: "exit", shutdownReceived: true });
			}).pipe(Effect.scoped),
	);

	it.live(
		"a one-chunk batch with no exit, ended in the same tick, resolves closed only after a slow notification handler has finished, and its notification and every response are written",
		() =>
			Effect.gen(function* () {
				const { input, output, transport } = yield* makeRawTransport();
				let handlerFinished = false;
				let handlerFinishedBeforeListen = false;
				let initializeAnsweredBeforeListen = false;
				let slowRequestAnsweredBeforeListen = false;
				let pongSentBeforeListen = false;
				yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
				yield* transport.onNotification("okfit/slow", () =>
					Effect.sleep("30 millis").pipe(
						Effect.andThen(transport.sendNotification("okfit/pong", { from: "drain" })),
						Effect.andThen(
							Effect.sync(() => {
								handlerFinished = true;
							}),
						),
					),
				);
				yield* transport.onRequest("okfit/slowRequest", () => Effect.sleep("30 millis").pipe(Effect.as({ ok: true })));
				const listening = yield* Effect.forkChild(
					transport.listen.pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								handlerFinishedBeforeListen = handlerFinished;
								initializeAnsweredBeforeListen = output.text().includes('"id":1');
								slowRequestAnsweredBeforeListen = output.text().includes('"id":2');
								pongSentBeforeListen = output.text().includes('"method":"okfit/pong"');
							}),
						),
					),
				);
				yield* Effect.sync(() =>
					input.end(
						[
							initializeFrame,
							frame({ jsonrpc: "2.0", method: "okfit/slow", params: {} }),
							frame({ jsonrpc: "2.0", id: 2, method: "okfit/slowRequest", params: {} }),
						].join(""),
					),
				);
				const outcome = yield* Fiber.join(listening).pipe(withListenTimeout);
				assert.isTrue(handlerFinishedBeforeListen, "the slow handler should have finished before listen resolved");
				assert.isTrue(
					initializeAnsweredBeforeListen,
					"the initialize response should have been written before listen resolved",
				);
				assert.isTrue(
					slowRequestAnsweredBeforeListen,
					"the slow request's response should have been written before listen resolved",
				);
				assert.isTrue(
					pongSentBeforeListen,
					"the notification the slow handler sent should have been written before listen resolved",
				);
				assert.deepStrictEqual(outcome, { reason: "closed", shutdownReceived: false });
			}).pipe(Effect.scoped),
	);

	it.live(
		"an input that ends in the middle of a frame after a valid initialize resolves listen with reason: closed",
		() =>
			Effect.gen(function* () {
				// The sentinel is swallowed into the truncated frame, so this exercises the fallback drain; a short
				// bound keeps the case fast instead of waiting out the production default (`reference.ts`'s TSDoc).
				const { input, output, transport } = yield* makeRawTransport({ fallback: "100 millis" });
				yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
				const listening = yield* Effect.forkChild(transport.listen);
				yield* Effect.sync(() => input.end(`${initializeFrame}Content-Length: 500\r\n\r\n{"jsonrpc":`));
				const outcome = yield* Fiber.join(listening).pipe(withListenTimeout);
				assert.include(output.text(), '"id":1', "the initialize response should have been written");
				assert.deepStrictEqual(outcome, { reason: "closed", shutdownReceived: false });
			}).pipe(Effect.scoped),
	);

	it.live("a client that sends okfit/$inputEnded itself does not end the session", () =>
		Effect.gen(function* () {
			const { input, transport } = yield* makeRawTransport();
			const after = yield* Deferred.make<void>();
			yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
			yield* transport.onRequest("okfit/after", () => Deferred.succeed(after, undefined).pipe(Effect.as({ ok: true })));
			const listening = yield* Effect.forkChild(transport.listen);
			yield* Effect.sync(() =>
				input.write(
					[
						initializeFrame,
						frame({ jsonrpc: "2.0", method: "okfit/$inputEnded", params: null }),
						frame({ jsonrpc: "2.0", id: 2, method: "okfit/after", params: {} }),
					].join(""),
				),
			);
			yield* Deferred.await(after);
			const early = yield* Fiber.join(listening).pipe(Effect.timeoutOption("200 millis"));
			assert.isTrue(Option.isNone(early), "listen should still be pending while the input is open");
			yield* Effect.sync(() => input.end());
			const outcome = yield* Fiber.join(listening).pipe(withListenTimeout);
			assert.deepStrictEqual(outcome, { reason: "closed", shutdownReceived: false });
		}).pipe(Effect.scoped),
	);

	it.effect("a handler registered after listen has started still answers (registration is not order-sensitive)", () =>
		Effect.gen(function* () {
			const { transport, client } = yield* makeHarness;
			yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
			yield* Effect.forkChild(transport.listen);
			yield* request(client, "initialize", { processId: null, rootUri: null, capabilities: {} });
			yield* transport.onRequest("okfit/late", () => Effect.succeed({ ok: true }));
			assert.deepStrictEqual(yield* request(client, "okfit/late", {}), { ok: true });
		}).pipe(Effect.scoped),
	);
	it.effect("a defect in a request handler answers -32603 with no stack trace, and logs the cause to the client", () =>
		Effect.gen(function* () {
			const { transport, client } = yield* makeHarness;
			const logged = yield* Deferred.make<string>();
			client.onNotification("window/logMessage", (params: { readonly message: string }) => {
				Effect.runSync(Deferred.succeed(logged, params.message));
			});
			yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
			yield* transport.onRequest("okfit/die", () => Effect.die(new Error("kaboom")));
			yield* Effect.forkChild(transport.listen);
			yield* request(client, "initialize", { processId: null, rootUri: null, capabilities: {} });
			const failure = yield* Effect.tryPromise({
				try: () => client.sendRequest("okfit/die", {}),
				catch: (error) => error as { readonly code: number; readonly message: string },
			}).pipe(Effect.flip);
			assert.strictEqual(failure.code, -32603);
			assert.notInclude(failure.message, "kaboom");
			assert.notMatch(failure.message, /\n\s+at\s/);
			assert.include(yield* Deferred.await(logged), "kaboom");
		}).pipe(Effect.scoped),
	);

	it.effect("handlers run with the services and references in context when the transport was built", () =>
		Effect.gen(function* () {
			const { transport, client } = yield* makeHarness;
			yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
			yield* transport.onRequest("okfit/stderr", () =>
				Effect.gen(function* () {
					return { logToStderr: yield* References.LogToStderr };
				}),
			);
			yield* Effect.forkChild(transport.listen);
			yield* request(client, "initialize", { processId: null, rootUri: null, capabilities: {} });
			assert.deepStrictEqual(yield* request(client, "okfit/stderr", {}), { logToStderr: true });
		}).pipe(Effect.scoped, Effect.provideService(References.LogToStderr, true)),
	);

	it.effect("closing the transport's scope interrupts an in-flight handler", () =>
		Effect.gen(function* () {
			const started = yield* Deferred.make<void>();
			const interrupted = yield* Deferred.make<void>();
			yield* Effect.gen(function* () {
				const { transport, client } = yield* makeHarness;
				yield* transport.onInitialize(() => Effect.succeed({ capabilities: {} }));
				yield* transport.onRequest("okfit/hang", () =>
					Deferred.succeed(started, undefined).pipe(
						Effect.andThen(Effect.never),
						Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
					),
				);
				yield* Effect.forkChild(transport.listen);
				yield* request(client, "initialize", { processId: null, rootUri: null, capabilities: {} });
				void client.sendRequest("okfit/hang", {}).catch(() => undefined);
				yield* Deferred.await(started);
			}).pipe(Effect.scoped);
			assert.isTrue(yield* Deferred.isDone(interrupted));
		}),
	);
});
