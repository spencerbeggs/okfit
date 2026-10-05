import type { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import { LSP_BIN, spawnLsp } from "./utils/lspBin.js";
import { makeSandbox } from "./utils/sandbox.js";

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
			const { response } = yield* server.readUntilResponse(1);
			const result = response.result as { readonly serverInfo: { readonly name: string } };
			assert.strictEqual(result.serverInfo.name, "okfit-lsp");
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
			yield* server.readUntilResponse(2);
			yield* server.send({ jsonrpc: "2.0", method: "exit", params: null });
			const code = yield* server.exitCode.pipe(
				Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("did not exit" as const) }),
			);
			assert.strictEqual(code, 0);
			yield* server.assertOnlyFrames;
			const stderr = yield* server.stderrFinal;
			assert.notOk(stderr.includes("Content-Length"));
			assert.ok(stderr.includes("okfit-lsp"));
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("a broken-link edit publishes a diagnostic over the wire", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox();
			const server = yield* spawnLsp(sandbox.env);
			yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(sandbox.cwd) });
			yield* server.readUntilResponse(1);
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
					const frame = yield* server.nextMessage;
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

	it.live("shutdown then exit exits 0 within two seconds when launched with --clientProcessId", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox();
			// The library's node entry installs a never-unref'd liveness interval at module load when this flag is in argv.
			const server = yield* spawnLsp(sandbox.env, [`--clientProcessId=${process.pid}`]);
			yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(sandbox.cwd) });
			yield* server.readUntilResponse(1);
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "shutdown", params: null });
			yield* server.readUntilResponse(2);
			yield* server.send({ jsonrpc: "2.0", method: "exit", params: null });
			const code = yield* server.exitCode.pipe(
				Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("did not exit" as const) }),
			);
			assert.strictEqual(code, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("exit without shutdown exits 1", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox();
			const server = yield* spawnLsp(sandbox.env);
			yield* server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initializeParams(sandbox.cwd) });
			yield* server.readUntilResponse(1);
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
			yield* server.readUntilResponse(1);
			yield* server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			yield* server.closeStdin;
			const code = yield* server.exitCode.pipe(
				Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("did not exit" as const) }),
			);
			assert.strictEqual(code, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.live("launched with stdin from /dev/null, exits 0 and writes nothing to stderr (#198)", () =>
		Effect.gen(function* () {
			const sandbox = yield* makeSandbox();
			// A file descriptor for stdin gives the child an fs.ReadStream, which has no `unref`.
			const result = yield* Effect.promise(
				() =>
					new Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>((resolve) => {
						const devNull = openSync("/dev/null", "r");
						const child = spawn(process.execPath, [LSP_BIN, "--stdio"], {
							env: sandbox.env,
							cwd: sandbox.cwd,
							stdio: [devNull, "pipe", "pipe"],
							timeout: 10_000,
						});
						closeSync(devNull);
						let stdout = "";
						let stderr = "";
						child.stdout?.on("data", (chunk: Buffer) => {
							stdout += chunk.toString();
						});
						child.stderr?.on("data", (chunk: Buffer) => {
							stderr += chunk.toString();
						});
						child.on("close", (code) => resolve({ code, stdout, stderr }));
					}),
			);
			assert.strictEqual(result.stdout, "");
			assert.strictEqual(result.stderr, "");
			assert.strictEqual(result.code, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});
