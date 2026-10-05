import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import { spawnLsp } from "./utils/lspBin.js";
import { makeSandbox } from "./utils/sandbox.js";

const initializeParams = (cwd: string) => ({
	processId: null,
	rootUri: pathToUri(cwd),
	capabilities: {},
	workspaceFolders: [{ uri: pathToUri(cwd), name: "p" }],
});

// The `exitBeforeConnect` policy in `src/main.ts`, both halves, against the
// built bin: a stray crash before the server is serving exits 1; the same
// crash once serving is logged and the server keeps answering.
describe("crash guards", () => {
	for (const kind of ["uncaughtException", "unhandledRejection"] as const) {
		it.live(`a ${kind} before the server is serving exits 1 with a report on stderr`, () =>
			Effect.gen(function* () {
				const sandbox = yield* makeSandbox();
				const server = yield* spawnLsp({ ...sandbox.env, OKFIT_LSP_TEST_INJECT_CRASH: `load:${kind}` });
				const code = yield* server.exitCode.pipe(
					Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail("did not exit" as const) }),
				);
				assert.strictEqual(code, 1);
				const stderr = yield* server.stderrFinal;
				assert.include(stderr, "okfit-lsp");
				assert.include(stderr, "[injected]");
				assert.strictEqual((yield* server.stdoutFinal).length, 0);
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		);

		it.live(`a ${kind} once serving is logged and the server keeps answering`, () =>
			Effect.gen(function* () {
				const sandbox = yield* makeSandbox();
				const server = yield* spawnLsp({ ...sandbox.env, OKFIT_LSP_TEST_INJECT_CRASH: `connected:${kind}` });
				yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(sandbox.cwd) });
				const init = yield* server.readUntilResponse(1);
				assert.strictEqual(init.response.id, 1);
				yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
				// The crash is raised on a timer after connect, so it can land after the
				// first response: ask again once it has, and the server must still answer.
				yield* Effect.sleep("500 millis");
				yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
				const shutdown = yield* server.readUntilResponse(2);
				assert.strictEqual(shutdown.response.id, 2);
				// Wait for the report rather than assume it has landed.
				const stderr = yield* server.stderrUntil((text) => text.includes("[injected]"), { timeout: "5 seconds" });
				assert.include(stderr, "[injected]");
				yield* server.send({ jsonrpc: "2.0", method: "exit", params: null });
				const code = yield* server.exitCode.pipe(
					Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.fail("did not exit" as const) }),
				);
				assert.strictEqual(code, 0);
			}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
		);
	}
});

// A launch failure must never reach stdout: stdout is the JSON-RPC wire, and a
// report there is read by the client as a corrupt frame.
describe("launch failure", () => {
	it.live("a launch without HOME exits 1 with the report on stderr and nothing on stdout", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox("okfit-lsp-no-home-", { home: false });
			const server = yield* spawnLsp(sandbox.env);
			const code = yield* server.exitCode.pipe(
				Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail("did not exit" as const) }),
			);
			assert.strictEqual(code, 1);
			assert.include(yield* server.stderrFinal, "HOME environment variable is not set");
			assert.strictEqual((yield* server.stdoutFinal).length, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});
