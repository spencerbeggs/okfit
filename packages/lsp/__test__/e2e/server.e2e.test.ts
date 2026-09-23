import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import { assertOnlyFrames, spawnLsp } from "./utils/lspProcess.js";
import { makeSandbox } from "./utils/sandbox.js";

/** A JSON-RPC response or notification frame, loosely typed for the assertions each case needs. */
interface JsonRpcFrame {
	readonly jsonrpc?: unknown;
	readonly id?: unknown;
	readonly method?: unknown;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

interface PublishDiagnosticsParams {
	readonly uri: string;
	readonly diagnostics: ReadonlyArray<{ readonly code?: string | number }>;
}

const initializeParams = (cwd: string) => ({
	processId: null,
	rootUri: pathToUri(cwd),
	capabilities: {},
	workspaceFolders: [{ uri: pathToUri(cwd), name: "p" }],
});

describe("okfit-lsp over real stdio", () => {
	it.live("initialize answers with the server name and stdout carries nothing but frames", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox();
			const server = yield* spawnLsp(sandbox.env);
			yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(sandbox.cwd) });
			const result = (yield* server.nextMessage) as {
				readonly id: number;
				readonly result: { readonly serverInfo: { readonly name: string } };
			};
			assert.strictEqual(result.result.serverInfo.name, "okfit-lsp");
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
			yield* server.nextMessage;
			yield* server.send({ jsonrpc: "2.0", method: "exit", params: null });
			const code = yield* server.exitCode.pipe(
				Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("did not exit" as const) }),
			);
			assert.strictEqual(code, 0);
			assertOnlyFrames(yield* server.rawStdoutSoFar);
			const stderr = yield* server.stderrSoFar;
			assert.notOk(stderr.includes("Content-Length"));
			assert.ok(stderr.includes("okfit-lsp"));
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("a broken-link edit publishes a diagnostic over the wire", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox();
			const server = yield* spawnLsp(sandbox.env);
			yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(sandbox.cwd) });
			yield* server.nextMessage;
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });

			const alphaUri = pathToUri(join(sandbox.cwd, "okf", "modules", "alpha.md"));
			const brokenText = yield* Effect.promise(() =>
				import("node:fs/promises").then((fs) =>
					fs
						.readFile(join(sandbox.cwd, "okf", "modules", "alpha.md"), "utf8")
						.then((text) => text.replace("See [Beta](beta.md).", "See [Gamma](gamma.md).")),
				),
			);
			yield* server.send({
				jsonrpc: "2.0",
				method: "textDocument/didOpen",
				params: {
					textDocument: { uri: alphaUri, languageId: "markdown", version: 1, text: brokenText },
				},
			});

			const published = yield* Effect.gen(function* () {
				while (true) {
					const frame = (yield* server.nextMessage) as JsonRpcFrame;
					if (frame.method === "textDocument/publishDiagnostics") {
						const params = frame.params as PublishDiagnosticsParams;
						if (params.uri === alphaUri) return params;
					}
				}
			}).pipe(Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.fail("no publish" as const) }));

			assert.ok(published.diagnostics.some((d) => d.code === "broken-links"));

			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
			yield* server.send({ jsonrpc: "2.0", method: "exit", params: null });
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("exit without shutdown exits 1", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox();
			const server = yield* spawnLsp(sandbox.env);
			yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(sandbox.cwd) });
			yield* server.nextMessage;
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* server.send({ jsonrpc: "2.0", method: "exit", params: null });
			const code = yield* server.exitCode.pipe(
				Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("did not exit" as const) }),
			);
			assert.strictEqual(code, 1);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("closing stdin after initialize exits 0 within two seconds", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox();
			const server = yield* spawnLsp(sandbox.env);
			yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(sandbox.cwd) });
			yield* server.nextMessage;
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* server.closeStdin;
			const code = yield* server.exitCode.pipe(
				Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("did not exit" as const) }),
			);
			assert.strictEqual(code, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});
