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

/**
 * Run the okfit MCP server over stdio. Owns the process.
 *
 * `McpGuard.run` (`@effected/mcp/guard`, itself free of static runtime
 * imports) installs the crash guards before `load` evaluates the server
 * graph, so a throw during module evaluation is still reported on stderr.
 * This module therefore carries no other static runtime import (`Distribution`
 * is type-only). The guard launches the server with `McpStdio.launch` and
 * `McpStdio.teardown` (stdin EOF exits `0`, not `130`).
 *
 * Policy is `exitBeforeConnect` for both events. Every tool is read-only and
 * reloads the bundle per call, so a stray error while serving has no state to
 * corrupt, and dying mid-session would only deregister the tools from the
 * client: the guard logs and keeps serving. Before serving the same error means
 * a broken boot, so it exits `1`. A `load()` that rejects is `startup failed`,
 * exit `1`, whatever the policy.
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
		injectCrash: McpGuard.parseInjectCrash(process.env.OKFIT_MCP_TEST_INJECT_CRASH),
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
