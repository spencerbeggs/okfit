import * as NodeServices from "@effect/platform-node/NodeServices";
import { AppDirs, Xdg } from "@effected/xdg";
import type { Scope } from "effect";
import { Deferred, Effect, Layer, Queue, Sink, Stdio, Stream } from "effect";
import { ServerLayer } from "../../src/server.js";

export interface JsonRpcMessage {
	readonly jsonrpc: "2.0";
	readonly id?: string | number | null | undefined;
	readonly method?: string | undefined;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

export interface ServedTool {
	readonly name: string;
	readonly title?: string;
	readonly description?: string;
	readonly inputSchema: Record<string, unknown>;
	readonly outputSchema?: Record<string, unknown>;
	readonly annotations?: Record<string, unknown>;
}
export interface ServedResource {
	readonly uri?: string;
	readonly uriTemplate?: string;
	readonly name: string;
	readonly description?: string;
	readonly mimeType?: string;
}
export interface CallToolResult {
	readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
	readonly structuredContent?: unknown;
	readonly isError?: boolean;
}
export interface ReadResourceResult {
	readonly contents: ReadonlyArray<{ readonly uri: string; readonly mimeType?: string; readonly text?: string }>;
}
export interface CompleteResult {
	readonly completion: { readonly values: ReadonlyArray<string>; readonly total?: number; readonly hasMore?: boolean };
}

export interface OkfitMcpHarness {
	readonly initialize: Effect.Effect<JsonRpcMessage>;
	readonly sendRaw: (message: unknown) => Effect.Effect<void>;
	readonly sendRequest: (method: string, params?: unknown) => Effect.Effect<JsonRpcMessage>;
	readonly sendNotification: (method: string, params?: unknown) => Effect.Effect<void>;
	readonly listTools: Effect.Effect<ReadonlyArray<ServedTool>>;
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<CallToolResult>;
	readonly listResources: Effect.Effect<ReadonlyArray<ServedResource>>;
	readonly readResource: (uri: string) => Effect.Effect<ReadResourceResult>;
	readonly complete: (uri: string, argument: { name: string; value: string }) => Effect.Effect<CompleteResult>;
	readonly takeStderr: Effect.Effect<string>;
}

const isJsonRpcMessage = (value: unknown): value is JsonRpcMessage =>
	typeof value === "object" && value !== null && (value as JsonRpcMessage).jsonrpc === "2.0";

const isResponse = (message: JsonRpcMessage): message is JsonRpcMessage & { readonly id: string | number } =>
	(typeof message.id === "string" || typeof message.id === "number") && message.method === undefined;

const requestKey = (id: string | number) => `${typeof id}:${id}`;

/**
 * The real platform layer, minus a live `Stdio`: `Xdg`/`AppDirs` composed
 * exactly as `bin.ts` does, so `resolveProjectConfig` and `Bundle.load` run
 * against a real fixture directory on disk. `Stdio` is supplied separately,
 * per test, by {@link makeHarness} via `Stdio.layerTest`.
 */
const PlatformLayer = Layer.mergeAll(
	Xdg.layer,
	AppDirs.layer({ namespace: "okfit" }).pipe(Layer.provide(Xdg.layer)),
).pipe(Layer.provideMerge(NodeServices.layer));

/**
 * An in-process JSON-RPC-over-stdio harness for `ServerLayer(projectRoot)`,
 * ported from Effect's own `McpStdioHarness`
 * (`.repos/effect/packages/effect/test/unstable/ai/McpServer/TestUtils/McpStdioHarness.ts`).
 * The one difference from upstream: this builds the real `ServerLayer`, not
 * a bare `McpServer.layerStdio`, over the real platform layer, so config
 * discovery and bundle loading run against an actual directory on disk.
 *
 * @public
 */
export const makeHarness = (projectRoot: string): Effect.Effect<OkfitMcpHarness, never, Scope.Scope> =>
	Effect.gen(function* () {
		const stdin = yield* Queue.unbounded<Uint8Array>();
		const stdout = yield* Queue.unbounded<string | Uint8Array>();
		const stderr = yield* Queue.unbounded<string | Uint8Array>();
		const messages = yield* Queue.unbounded<JsonRpcMessage>();
		const rawStderr = yield* Queue.unbounded<string>();
		const responseQueues = new Map<string, Queue.Queue<JsonRpcMessage>>();
		const encoder = new TextEncoder();
		const stdoutDecoder = new TextDecoder();
		const stderrDecoder = new TextDecoder();
		let nextRequestId = 1;

		const stdioLayer = Stdio.layerTest({
			stdin: Stream.fromQueue(stdin),
			// biome-ignore lint/suspicious/useIterableCallbackReturn: Sink.forEach's callback returns the offering Effect; this is not Array#forEach.
			stdout: () => Sink.forEach((chunk: string | Uint8Array) => Queue.offer(stdout, chunk)),
			// biome-ignore lint/suspicious/useIterableCallbackReturn: Sink.forEach's callback returns the offering Effect; this is not Array#forEach.
			stderr: () => Sink.forEach((chunk: string | Uint8Array) => Queue.offer(stderr, chunk)),
		});

		const ready = yield* Deferred.make<void>();
		yield* Effect.gen(function* () {
			yield* Layer.build(ServerLayer(projectRoot).pipe(Layer.provide(stdioLayer), Layer.provide(PlatformLayer)));
			yield* Deferred.succeed(ready, undefined);
			return yield* Effect.never;
		}).pipe(Effect.scoped, Effect.forkScoped);
		yield* Deferred.await(ready);

		const routeFrame = (frame: unknown): Effect.Effect<void> =>
			Effect.gen(function* () {
				if (!isJsonRpcMessage(frame)) return;
				if (isResponse(frame)) {
					const responseQueue = responseQueues.get(requestKey(frame.id));
					if (responseQueue !== undefined) {
						yield* Queue.offer(responseQueue, frame);
						return;
					}
				}
				yield* Queue.offer(messages, frame);
			});

		yield* Effect.gen(function* () {
			let pending = "";
			while (true) {
				const chunk = yield* Queue.take(stdout);
				const text = typeof chunk === "string" ? chunk : stdoutDecoder.decode(chunk, { stream: true });
				pending += text;
				let newline = pending.indexOf("\n");
				while (newline !== -1) {
					const line = pending.slice(0, newline);
					pending = pending.slice(newline + 1);
					if (line.length > 0) {
						yield* routeFrame(JSON.parse(line));
					}
					newline = pending.indexOf("\n");
				}
			}
		}).pipe(Effect.forkScoped);

		yield* Effect.gen(function* () {
			while (true) {
				const chunk = yield* Queue.take(stderr);
				yield* Queue.offer(
					rawStderr,
					typeof chunk === "string" ? chunk : stderrDecoder.decode(chunk, { stream: true }),
				);
			}
		}).pipe(Effect.forkScoped);

		const sendChunk = (chunk: string | Uint8Array): Effect.Effect<void> =>
			Queue.offer(stdin, typeof chunk === "string" ? encoder.encode(chunk) : chunk);
		const sendRaw = (message: unknown): Effect.Effect<void> => sendChunk(`${JSON.stringify(message)}\n`);
		const sendNotification = (method: string, params?: unknown): Effect.Effect<void> =>
			sendRaw({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
		const sendRequest = (method: string, params?: unknown): Effect.Effect<JsonRpcMessage> =>
			Effect.gen(function* () {
				const id = nextRequestId++;
				const responseQueue = yield* Queue.unbounded<JsonRpcMessage>();
				const key = requestKey(id);
				responseQueues.set(key, responseQueue);
				yield* sendRaw({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
				return yield* Queue.take(responseQueue).pipe(Effect.ensuring(Effect.sync(() => responseQueues.delete(key))));
			});

		const initialize: Effect.Effect<JsonRpcMessage> = Effect.gen(function* () {
			const response = yield* sendRequest("initialize", {
				protocolVersion: "2025-11-25",
				capabilities: {},
				clientInfo: { name: "okfit-test", version: "0.0.0" },
			});
			yield* sendNotification("notifications/initialized");
			return response;
		});

		const listTools: Effect.Effect<ReadonlyArray<ServedTool>> = sendRequest("tools/list").pipe(
			Effect.map((response) => (response.result as { readonly tools: ReadonlyArray<ServedTool> }).tools),
		);
		const callTool = (name: string, args?: unknown): Effect.Effect<CallToolResult> =>
			sendRequest("tools/call", { name, arguments: args ?? {} }).pipe(
				Effect.map((response) =>
					response.error === undefined ? (response.result as CallToolResult) : (response as never),
				),
			);
		const listResources: Effect.Effect<ReadonlyArray<ServedResource>> = sendRequest("resources/list").pipe(
			Effect.map((response) => (response.result as { readonly resources: ReadonlyArray<ServedResource> }).resources),
		);
		const readResource = (uri: string): Effect.Effect<ReadResourceResult> =>
			sendRequest("resources/read", { uri }).pipe(
				Effect.map((response) =>
					response.error === undefined ? (response.result as ReadResourceResult) : (response as never),
				),
			);
		const complete = (uri: string, argument: { name: string; value: string }): Effect.Effect<CompleteResult> =>
			sendRequest("completion/complete", { ref: { type: "ref/resource", uri }, argument }).pipe(
				Effect.map((response) => response.result as CompleteResult),
			);

		return {
			initialize,
			sendRaw,
			sendRequest,
			sendNotification,
			listTools,
			callTool,
			listResources,
			readResource,
			complete,
			takeStderr: Queue.take(rawStderr),
		};
	});
