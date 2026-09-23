import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, References } from "effect";
import { LspError } from "../../src/errors.js";
import { makeHarness, notify, request } from "../utils/harness.js";

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
