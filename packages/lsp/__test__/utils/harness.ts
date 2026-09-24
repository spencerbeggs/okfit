import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Duration, Fiber, Layer, Scope } from "effect";
import { Effect, Logger, Queue } from "effect";
import type { GenericRequestHandler, MessageConnection } from "vscode-jsonrpc/node";
import { StreamMessageReader, StreamMessageWriter, createMessageConnection } from "vscode-jsonrpc/node";
import { pathToUri } from "../../src/convert/uri.js";
import type { ListenOutcome, LspTransportShape } from "../../src/protocol/LspTransport.js";
import { makeReferenceTransport } from "../../src/protocol/reference.js";
import type { InitializeResult } from "../../src/protocol/types.js";
import type { ServeServices } from "../../src/server.js";
import { serve } from "../../src/server.js";
import { copyFixtureProject } from "./fixture.js";
import { testPlatform } from "./platform.js";

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

/** One notification of any method the client received, recorded alongside {@link Published}'s own queue. */
export interface RecordedNotification {
	readonly method: string;
	readonly params: unknown;
}

export interface Harness {
	readonly transport: LspTransportShape;
	readonly client: MessageConnection;
	/** Next publishDiagnostics notification the client received; fails after `timeout`. */
	readonly nextPublish: (timeout?: Duration.Input) => Effect.Effect<Published, "no publish">;
	/** Every publish received so far, drained. */
	readonly drainPublished: Effect.Effect<ReadonlyArray<Published>>;
	readonly closeClientOutput: Effect.Effect<void>;
	/** Every publish already received, taken without waiting for more. */
	readonly pollPublished: Effect.Effect<ReadonlyArray<Published>>;
	/** Takes publishes until one satisfies `predicate` and returns it; fails when none does within `timeout` in total. */
	readonly drainUntil: (
		predicate: (published: Published) => boolean,
		timeout?: Duration.Input,
	) => Effect.Effect<Published, "no publish">;
	/**
	 * Next notification of any method (recorded independently of `nextPublish`'s
	 * own queue, so consuming one does not affect the other) satisfying
	 * `predicate`; fails after `timeout`.
	 */
	readonly nextNotification: (
		predicate: (notification: RecordedNotification) => boolean,
		timeout?: Duration.Input,
	) => Effect.Effect<RecordedNotification, "no notification">;
	/** Every server-to-client request the harness's client answered, recorded in arrival order. */
	readonly serverRequests: Array<{ readonly method: string; readonly params: unknown }>;
	/**
	 * Registers `handler` as the client's answer to `method`: `vscode-jsonrpc`'s
	 * `MessageConnection.onRequest` keys its handler map by method name, so a
	 * later call for the same method replaces an earlier one rather than
	 * stacking -- a test overriding the harness's default `workspace/applyEdit`
	 * handler before a request arrives simply calls this again.
	 */
	readonly onServerRequest: <P, R>(method: string, handler: (params: P) => R | Promise<R>) => void;
}

/**
 * Silences every log line (`serve`'s `Effect.logInfo` on `initialized`,
 * `Effect.logWarning` on a failed revalidate): `Logger.layer([])` with
 * `mergeWithExisting` left at its default `false` replaces the current
 * logger set with an empty one, so nothing reaches `console.*` -- vitest's
 * console-leak check sees no writes from this harness, without changing
 * what the real process (`main.ts`, which keeps the default logger routed
 * to stderr) logs in production. Provided here, around
 * `makeReferenceTransport` itself, rather than only around `serve(...)`:
 * the reference transport's `onInitialize`/`onNotification`/`onRequest`
 * dispatch every handler through a `Runtime` captured once, at
 * transport-construction time (`FiberSet.runtime`), so a later
 * `Effect.provide` wrapped around `serve(...)` never reaches a log line a
 * transport-dispatched handler (like `onInitialized`'s) emits -- only work
 * forked from `serve`'s own execution (the scheduler, a revalidate) sees
 * that later provide.
 */
const silentLogger = Logger.layer([]);

export const makeHarness: Effect.Effect<Harness, never, Scope.Scope> = Effect.gen(function* () {
	const clientToServer = new PassThrough();
	const serverToClient = new PassThrough();
	const transport = yield* makeReferenceTransport({ streams: { input: clientToServer, output: serverToClient } });
	const client = createMessageConnection(
		new StreamMessageReader(serverToClient),
		new StreamMessageWriter(clientToServer),
	);
	const published = yield* Queue.unbounded<Published>();
	const notifications = yield* Queue.unbounded<RecordedNotification>();
	// A star handler, not a per-method one: it sees every notification the server sends, `textDocument/publishDiagnostics`
	// included, feeding both this generic queue and `published`'s own so existing `Published`-only accessors are unaffected.
	client.onNotification((method: string, params: unknown) => {
		Effect.runSync(Queue.offer(notifications, { method, params }));
		if (method === "textDocument/publishDiagnostics") {
			Effect.runSync(Queue.offer(published, params as Published));
		}
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
	const drainUntil = (predicate: (published: Published) => boolean, timeout: Duration.Input = "5 seconds") =>
		Effect.gen(function* () {
			while (true) {
				const next = yield* Queue.take(published);
				if (predicate(next)) return next;
			}
		}).pipe(Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.fail("no publish" as const) }));
	const pollPublished: Effect.Effect<ReadonlyArray<Published>> = Queue.clear(published);
	const nextNotification = (
		predicate: (notification: RecordedNotification) => boolean,
		notificationTimeout: Duration.Input = "5 seconds",
	) =>
		Effect.gen(function* () {
			while (true) {
				const next = yield* Queue.take(notifications);
				if (predicate(next)) return next;
			}
		}).pipe(
			Effect.timeoutOrElse({ duration: notificationTimeout, orElse: () => Effect.fail("no notification" as const) }),
		);
	const serverRequests: Array<{ method: string; params: unknown }> = [];
	const onServerRequest = <P, R>(method: string, handler: (params: P) => R | Promise<R>): void => {
		client.onRequest(method, ((params: P) => {
			serverRequests.push({ method, params });
			return handler(params);
		}) as GenericRequestHandler<R, unknown>);
	};
	onServerRequest("workspace/applyEdit", () => ({ applied: true }));
	return {
		transport,
		client,
		nextPublish,
		drainPublished,
		closeClientOutput,
		drainUntil,
		pollPublished,
		nextNotification,
		serverRequests,
		onServerRequest,
	};
}).pipe(Effect.provide(silentLogger));

/** A {@link Harness} with `serve` running against a fresh copy of the fixture project. */
export interface ServeHarness extends Harness {
	/** The fixture copy's root (realpath-resolved). */
	readonly root: string;
	/** The forked `serve`; joins with its `ListenOutcome`. */
	readonly listening: Fiber.Fiber<ListenOutcome>;
	/** `initialize` with `root` as the one workspace folder, then `initialized`. */
	readonly initialize: Effect.Effect<InitializeResult>;
	/** `textDocument/didOpen` at version 1; reads the file from disk when `text` is omitted. */
	readonly open: (relative: string, text?: string) => Effect.Effect<void>;
	/** `textDocument/didChange` with one whole-document change; `version` defaults to 2. */
	readonly change: (relative: string, text: string, version?: number) => Effect.Effect<void>;
	readonly save: (relative: string) => Effect.Effect<void>;
	readonly close: (relative: string) => Effect.Effect<void>;
	/** The `file:` URI of `relative` under `root` (`""` is `root` itself). */
	readonly uriOf: (relative: string) => string;
}

/** Options for {@link makeServeHarness}. */
export interface ServeHarnessOptions {
	/** The scheduler's debounce; defaults to 10 ms. A test asserting a count of publishes needs one wide enough to hold its burst under load. */
	readonly delay?: Duration.Input;
	/**
	 * The platform layer `serve` runs under; defaults to `testPlatform()`.
	 * `serve` is forked and fully provided inside this constructor, so a
	 * `Effect.provide` wrapped around the returned harness's own effects
	 * never reaches it -- a test needing a different `Git` double (a real
	 * identity, say) passes its own layer here instead.
	 */
	readonly platform?: Layer.Layer<ServeServices>;
}

/** Copies the fixture, builds a transport pair, and forks `serve` with `delay` (10 ms by default) under `options.platform` (`testPlatform()` by default). */
export const makeServeHarness = (options: ServeHarnessOptions = {}): Effect.Effect<ServeHarness, never, Scope.Scope> =>
	Effect.gen(function* () {
		const { root } = yield* copyFixtureProject();
		const harness = yield* makeHarness;
		const listening = yield* Effect.forkScoped(
			serve(harness.transport, { delay: options.delay ?? "10 millis" }).pipe(
				Effect.provide(options.platform ?? testPlatform()),
				Effect.provide(silentLogger),
			),
		);
		const uriOf = (relative: string): string => pathToUri(join(root, relative));
		const initialize = Effect.gen(function* () {
			const result = yield* request<InitializeResult>(harness.client, "initialize", {
				processId: null,
				rootUri: pathToUri(root),
				capabilities: {},
				workspaceFolders: [{ uri: pathToUri(root), name: "project" }],
				initializationOptions: {},
			});
			yield* notify(harness.client, "initialized", {});
			return result;
		});
		const open = (relative: string, text?: string) =>
			Effect.gen(function* () {
				const body = text ?? (yield* Effect.promise(() => readFile(join(root, relative), "utf8")));
				yield* notify(harness.client, "textDocument/didOpen", {
					textDocument: { uri: uriOf(relative), languageId: "markdown", version: 1, text: body },
				});
			});
		const change = (relative: string, text: string, version = 2) =>
			notify(harness.client, "textDocument/didChange", {
				textDocument: { uri: uriOf(relative), version },
				contentChanges: [{ text }],
			});
		const save = (relative: string) =>
			notify(harness.client, "textDocument/didSave", { textDocument: { uri: uriOf(relative) } });
		const close = (relative: string) =>
			notify(harness.client, "textDocument/didClose", { textDocument: { uri: uriOf(relative) } });
		return { ...harness, root, listening, initialize, open, change, save, close, uriOf };
	});

/** `client.sendRequest` as an Effect. */
export const request = <R>(client: MessageConnection, method: string, params: unknown): Effect.Effect<R> =>
	Effect.promise(() => client.sendRequest(method, params) as Promise<R>);

/** `client.sendNotification` as an Effect. */
export const notify = (client: MessageConnection, method: string, params: unknown): Effect.Effect<void> =>
	Effect.promise(() => client.sendNotification(method, params));
