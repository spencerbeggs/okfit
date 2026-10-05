/**
 * The assembled okfit MCP server program.
 *
 * @packageDocumentation
 */

import { McpGuard } from "@effected/mcp/guard";
import type { Distribution } from "@okfit/engine";

/**
 * Options `@okfit/plugin`'s `okfit-mcp` bin shim (and only it, today) passes
 * to {@link main}. `distribution` names the meta-package the server was
 * launched through; omitted for a direct install of `@okfit/mcp` (okfit
 * #137).
 *
 * @public
 */
export interface MainOptions {
	readonly distribution?: Distribution;
}

/** What {@link parseInjectCrash} yields: the guard's `injectCrash` option. */
interface InjectCrash {
	readonly at: "load" | "connected";
	readonly kind: "uncaughtException" | "unhandledRejection";
}

const INJECT_AT: ReadonlyArray<InjectCrash["at"]> = ["load", "connected"];
const INJECT_KIND: ReadonlyArray<InjectCrash["kind"]> = ["uncaughtException", "unhandledRejection"];

/**
 * Parse the test-only `OKFIT_MCP_TEST_INJECT_CRASH` value into the guard's
 * `injectCrash`: `<at>:<kind>`, where `at` is `load` or `connected` and
 * `kind` is `uncaughtException` or `unhandledRejection`. Anything else, or
 * no value, is `undefined` (no injection). Only the e2e suite sets it.
 */
const parseInjectCrash = (value: string | undefined): InjectCrash | undefined => {
	if (value === undefined) return undefined;
	const [at, kind, ...rest] = value.split(":");
	if (rest.length > 0) return undefined;
	const validAt = INJECT_AT.find((candidate) => candidate === at);
	const validKind = INJECT_KIND.find((candidate) => candidate === kind);
	return validAt === undefined || validKind === undefined ? undefined : { at: validAt, kind: validKind };
};

/**
 * Run the okfit MCP server over stdio. Owns the process.
 *
 * `McpGuard.run` (`@effected/mcp/guard`, itself free of static runtime
 * imports) installs the `uncaughtException` and `unhandledRejection`
 * guards before `load` evaluates `NodeRuntime`, `@effected/mcp`, the engine
 * platform and `ServerLayer`, so a throw during module evaluation is still
 * reported on stderr. This module therefore carries no other static runtime
 * import: `Distribution` is a type-only import, erased at build time. The
 * guard then launches the server with `McpStdio.launch`/`McpStdio.teardown`
 * (stdin EOF exits `0`, not `130`). `ServerLayer`'s stdio server is built on
 * `McpStdio.layer`, which already routes logs to stderr.
 *
 * The crash policy is `exitBeforeConnect` for both events. Every okfit tool
 * is read-only and reloads the bundle from disk on each call, so a stray
 * error after the server is serving has no state to corrupt and no in-flight
 * caller (core scrubs a throw inside a tool call into an `isError` result);
 * dying mid-session would only deregister all six tools from the client, so
 * the guard logs and keeps serving. Before the server is serving the same
 * error means a broken boot, where exiting `1` is the honest outcome.
 * Rejections follow the same rule rather than `"log"`, so a rejection while
 * loading is never silently carried into a half-built server. A `load()`
 * that rejects is `startup failed`, exit `1`, whatever the policy.
 *
 * @public
 */
export const main = (options: MainOptions = {}): Promise<void> =>
	McpGuard.run({
		label: "okfit-mcp",
		host: process,
		policy: { onUncaught: "exitBeforeConnect", onRejection: "exitBeforeConnect" },
		// Test-only: the e2e suite sets it to raise one stray crash before
		// `load()` or once serving. Never set in a normal install.
		injectCrash: parseInjectCrash(process.env.OKFIT_MCP_TEST_INJECT_CRASH),
		load: async () => {
			// No static imports of the server graph above this line.
			const NodeRuntime = await import("@effect/platform-node/NodeRuntime");
			const { OkfitPlatform } = await import("@okfit/engine");
			const { Layer } = await import("effect");
			const { resolveMcpProjectRoot } = await import("./internal/projectRoot.js");
			const { ServerLayer } = await import("./server.js");

			const projectRoot = resolveMcpProjectRoot(process.env, process.cwd());
			const layer = ServerLayer(projectRoot, options).pipe(Layer.provide(OkfitPlatform));
			return { layer, runMain: NodeRuntime.runMain };
		},
	});
