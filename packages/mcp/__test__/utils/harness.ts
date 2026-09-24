import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import type { JsonRpcMessage, McpTestFailure, ServedResource, ServedTool } from "@effected/mcp/testing";
import { McpHarness } from "@effected/mcp/testing";
import { AppDirs, Xdg } from "@effected/xdg";
import type { Scope } from "effect";
import { Effect, Layer } from "effect";
import { McpProtocol } from "effect/unstable/ai";
import type { ServerOptions } from "../../src/server.js";
import { ServerLayer } from "../../src/server.js";

export type { ServedResource } from "@effected/mcp/testing";

/**
 * The three adapters `ServerLayer` declares, spelled as the wire-format
 * strings this package's own tests already use, mapped onto
 * `@effected/mcp/testing`'s `McpHarness`, which takes a `McpProtocol.ProtocolAdapter`
 * rather than a bare string.
 */
export type ProtocolVersion = "2026-07-28" | "2025-11-25" | "2025-06-18";

const PROTOCOL_ADAPTERS: Record<ProtocolVersion, McpProtocol.ProtocolAdapter> = {
	"2026-07-28": McpProtocol.v2026_07_28,
	"2025-11-25": McpProtocol.v2025_11_25,
	"2025-06-18": McpProtocol.v2025_06_18,
};

export interface CallToolResult {
	readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
	readonly structuredContent?: unknown;
	readonly isError?: boolean;
}
export interface ReadResourceResult {
	readonly contents: ReadonlyArray<{ readonly uri: string; readonly mimeType?: string; readonly text?: string }>;
}
export interface DiscoverResult {
	readonly supportedVersions: ReadonlyArray<string>;
	readonly capabilities: Record<string, unknown>;
	readonly instructions?: string;
	readonly _meta?: Record<string, unknown>;
	readonly resultType?: string;
}

export interface HarnessOptions extends ServerOptions {
	readonly protocolVersion?: ProtocolVersion;
}

export interface OkfitMcpHarness {
	readonly protocolVersion: ProtocolVersion;
	readonly initialize: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly discover: Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly sendRequest: (method: string, params?: unknown) => Effect.Effect<JsonRpcMessage, McpTestFailure>;
	readonly listTools: Effect.Effect<ReadonlyArray<ServedTool>, McpTestFailure>;
	readonly callTool: (name: string, args?: unknown) => Effect.Effect<CallToolResult, McpTestFailure>;
	readonly listResources: Effect.Effect<ReadonlyArray<ServedResource>, McpTestFailure>;
	readonly readResource: (uri: string) => Effect.Effect<ReadResourceResult, McpTestFailure>;
}

/**
 * The real platform layer, minus `Stdio` (and `Terminal`, which no code path
 * here needs): `Xdg`/`AppDirs` composed exactly as `bin.ts` does, so
 * `resolveProjectConfig` and `Bundle.load` run against a real fixture
 * directory on disk, over the individual `FileSystem`/`Path`/`Crypto`/
 * `ChildProcessSpawner` layers `@effect/platform-node/NodeServices`' own
 * source composes internally -- deliberately NOT the `NodeServices.layer`
 * bundle itself, which also carries `NodeStdio.layer`. `Stdio` is supplied
 * internally by `McpHarness.make`, over queue-backed stdio -- see
 * `@effected/mcp/testing`'s own reference for why a harness is passed a
 * server layer WITHOUT its own `Stdio`. Pulling in `NodeServices.layer`
 * wholesale satisfies the server's `Stdio` requirement with the REAL
 * `process.stdin`/`stdout` before `McpHarness.make` ever gets a chance to
 * inject its test queues -- every test then hangs waiting on real stdin
 * that a vitest worker never provides.
 */
const NodePlatformLayer = Layer.provideMerge(
	NodeChildProcessSpawner.layer,
	Layer.mergeAll(NodeFileSystem.layer, NodeCrypto.layer, NodePath.layer),
);
const PlatformLayer = Layer.mergeAll(
	Xdg.layer,
	AppDirs.layer({ namespace: "okfit" }).pipe(Layer.provide(Xdg.layer)),
).pipe(Layer.provideMerge(NodePlatformLayer));

/**
 * `tools/call` and `resources/read` return the whole `JsonRpcMessage` from
 * `@effected/mcp/testing`'s `McpHarness` (a JSON-RPC error is data, same as
 * every other request) -- unwrapped here to `.result` for the common case
 * this package's own tests want, matching the shape the hand-rolled harness
 * this replaces returned. A caller that needs to see a JSON-RPC-level
 * `.error` (this package's own protocol- and resource-failure tests) still
 * goes through `sendRequest` directly, which is never unwrapped.
 * `listResources` needs none of this: `McpHarness.listResources` already
 * unwraps `resources/list`'s `.result.resources` and fails typed
 * (`ErrorResponse`) on a JSON-RPC error, so it is exposed here verbatim.
 */
const unwrapResult = <A>(response: JsonRpcMessage): A =>
	(response.error === undefined ? response.result : response) as A;

/**
 * An in-process MCP client for `ServerLayer(projectRoot)`, over
 * `@effected/mcp/testing`'s `McpHarness` -- the kit's own in-process,
 * queue-backed-stdio test client. What this wrapper still owns: the real
 * platform layer (`Xdg`/`AppDirs`/
 * the individual Node platform layers), the `ProtocolVersion` string ->
 * `McpProtocol.ProtocolAdapter` mapping this package's tests are already
 * written against, and unwrapping `callTool`/`readResource`'s `.result` for
 * the common case (see {@link unwrapResult}). `listResources` is the kit's
 * own convenience method, passed through unchanged.
 *
 * `McpHarness.make`'s own error channel is `Xdg.layer`'s real (K-13,
 * `packages/engine/src/platform.ts`) `XdgEnvError` -- `ServerLayer` itself
 * never fails to build. Production code renders it (a caller's
 * responsibility per K-13's own doc comment); a test fixture's `HOME` is
 * never unset, so it is discharged with `Effect.orDie` here rather than
 * threading a typed failure every one of this package's tests would then
 * have to declare and never actually exercise.
 *
 * @public
 */
export const makeHarness = (
	projectRoot: string,
	options: HarnessOptions = {},
): Effect.Effect<OkfitMcpHarness, never, Scope.Scope> =>
	Effect.gen(function* () {
		const protocolVersion = options.protocolVersion ?? "2025-11-25";
		const serverOptions: ServerOptions =
			options.distribution === undefined ? {} : { distribution: options.distribution };
		const harness = yield* McpHarness.make(ServerLayer(projectRoot, serverOptions).pipe(Layer.provide(PlatformLayer)), {
			protocol: PROTOCOL_ADAPTERS[protocolVersion],
		}).pipe(Effect.orDie);
		return {
			protocolVersion,
			initialize: harness.initialize,
			discover: harness.discover,
			sendRequest: (method, params) => harness.request(method, params),
			listTools: harness.listTools,
			callTool: (name, args) => harness.callTool(name, args).pipe(Effect.map(unwrapResult<CallToolResult>)),
			listResources: harness.listResources,
			readResource: (uri) => harness.readResource(uri).pipe(Effect.map(unwrapResult<ReadResourceResult>)),
		};
	});
