import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { McpProcess } from "@effected/mcp/testing";
import { Effect, Schedule } from "effect";
import { ChildProcess } from "effect/process";

/** The built dev bin, resolved from this file's own location, never from cwd. */
const MCP_BIN = resolve(import.meta.dirname, "..", "..", "dist", "dev", "pkg", "bin", "okfit-mcp.js");
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");

const spawnWithCrash = (injection: string) =>
	McpProcess.spawn(
		ChildProcess.make(process.execPath, [MCP_BIN], {
			env: {
				PATH: process.env.PATH ?? "",
				HOME: process.env.HOME ?? "",
				NO_COLOR: "1",
				OKFIT_PROJECT_DIR: REPO_ROOT,
				OKFIT_MCP_TEST_INJECT_CRASH: injection,
			},
		}),
	);

const INITIALIZE = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: { name: "okfit-e2e", version: "0.0.0" },
	},
} as const;

// The `exitBeforeConnect` policy in `src/main.ts`, both halves, against the
// built bin: a stray crash before the server is serving exits 1; the same
// crash once serving is logged and the server keeps answering.
describe("crash guards", () => {
	for (const kind of ["uncaughtException", "unhandledRejection"] as const) {
		it.live(`a ${kind} before the server is serving exits 1 with a report on stderr`, () =>
			Effect.gen(function* () {
				const server = yield* spawnWithCrash(`load:${kind}`);
				const code = yield* server.exitCode.pipe(
					Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail("did not exit" as const) }),
				);
				assert.strictEqual(code, 1);
				const stderr = yield* server.stderrSoFar;
				assert.include(stderr, "okfit-mcp");
				assert.include(stderr, "[injected]");
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		);

		it.live(`a ${kind} once serving is logged and the server keeps answering`, () =>
			Effect.gen(function* () {
				const server = yield* spawnWithCrash(`connected:${kind}`);
				yield* server.send(INITIALIZE);
				yield* server.readUntilResponse(1);
				yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
				yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
				const { response } = yield* server.readUntilResponse(2);
				const tools = (response as { readonly result: { readonly tools: ReadonlyArray<unknown> } }).result.tools;
				assert.strictEqual(tools.length, 6);
				// The crash is raised on a timer after connect, so poll (real clock)
				// until the report lands rather than reading stderr once.
				const stderr = yield* server.stderrSoFar.pipe(
					Effect.repeat({
						schedule: Schedule.spaced("50 millis"),
						until: (text) => text.includes("[injected]"),
						times: 100,
					}),
				);
				assert.include(stderr, "[injected]");
				yield* server.closeStdin;
				const code = yield* server.exitCode.pipe(
					Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.fail("did not exit" as const) }),
				);
				assert.strictEqual(code, 0);
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		);
	}
});
