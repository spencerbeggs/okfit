import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { McpProcess } from "./utils/mcpProcess.js";
import { spawnMcp } from "./utils/mcpProcess.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const CLI_BIN = resolve(REPO_ROOT, "packages", "cli", "dist", "dev", "pkg", "bin", "okfit.js");

const ENV = {
	PATH: process.env.PATH ?? "",
	HOME: process.env.HOME ?? "",
	NO_COLOR: "1",
	OKFIT_PROJECT_DIR: REPO_ROOT,
} as const;

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

/**
 * Read stdout lines until one carries the requested `id`, skipping any
 * unsolicited notification in between.
 *
 * Not part of the brief's normative `McpProcess` interface (only
 * `nextLine` is), and needed here rather than assumed away: this server
 * sends `notifications/tools/list_changed` and (once, sometimes twice --
 * once per registered resource layer) `notifications/resources/list_changed`
 * after boot, and their arrival on stdout interleaves with the next
 * request/response pair rather than always preceding it -- reproduced
 * directly against the built bin, where a `validate_bundle` call (slow
 * enough to leave room for the notification) received three notification
 * lines before its own response. A `nextLine`-per-expected-line loop, as
 * the brief's literal case bodies assumed, is not reliable against this
 * server's real output ordering.
 */
interface JsonRpcLine {
	readonly jsonrpc?: unknown;
	readonly id?: unknown;
	readonly method?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

/**
 * Read and collect every stdout line up to and including the one carrying
 * the requested `id`. `seen` carries every line read along the way
 * (notifications included) so a case that wants to inspect all of them
 * (e.g. that each one parses as JSON-RPC) still can.
 */
const readUntilResponse = (
	server: McpProcess,
	id: number,
): Effect.Effect<{ readonly response: JsonRpcLine; readonly seen: ReadonlyArray<JsonRpcLine> }> =>
	Effect.gen(function* () {
		const seen: Array<JsonRpcLine> = [];
		while (true) {
			const parsed = JSON.parse(yield* server.nextLine) as JsonRpcLine;
			seen.push(parsed);
			if (parsed.id === id) return { response: parsed, seen };
		}
	});

const readResponse = (server: McpProcess, id: number): Effect.Effect<JsonRpcLine> =>
	Effect.map(readUntilResponse(server, id), ({ response }) => response);

describe("server lifecycle", () => {
	it.effect("completes the initialize handshake and lists six tools over real stdio", () =>
		Effect.gen(function* () {
			const server = yield* spawnMcp(ENV);
			yield* server.send(INITIALIZE);
			const initialized = (yield* readResponse(server, 1)) as {
				readonly result: { readonly protocolVersion: string; readonly serverInfo: { readonly name: string } };
			};
			assert.strictEqual(initialized.result.serverInfo.name, "okfit");
			assert.strictEqual(initialized.result.protocolVersion, "2025-11-25");
			yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
			const listed = (yield* readResponse(server, 2)) as {
				readonly result: { readonly tools: ReadonlyArray<{ readonly name: string }> };
			};
			assert.strictEqual(listed.result.tools.length, 6);
			yield* server.closeStdin;
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.effect("every stdout line parses as a JSON-RPC message, including a failing tool call", () =>
		Effect.gen(function* () {
			const server = yield* spawnMcp(ENV);
			yield* server.send(INITIALIZE);
			const { seen: fromInitialize } = yield* readUntilResponse(server, 1);
			yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
			yield* server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
			const { seen: fromToolsList } = yield* readUntilResponse(server, 2);
			// A failing tool call is the only thing that emits a log line
			// (final whole-branch review, Important finding 2): without one here
			// this case's name is not backed by its assertion, since the happy
			// paths above never exercise the logger at all.
			yield* server.send({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "get_concept", arguments: { id: "nope" } },
			});
			const { seen: fromFailingCall } = yield* readUntilResponse(server, 3);
			for (const line of [...fromInitialize, ...fromToolsList, ...fromFailingCall]) {
				assert.strictEqual(line.jsonrpc, "2.0");
			}
			yield* server.closeStdin;
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.effect("stderr carries no protocol bytes and receives the failing call's log line", () =>
		Effect.gen(function* () {
			const server = yield* spawnMcp(ENV);
			yield* server.send(INITIALIZE);
			yield* readResponse(server, 1);
			yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
			yield* server.send({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "get_concept", arguments: { id: "nope" } },
			});
			yield* readResponse(server, 2);
			const stderr = yield* server.stderrSoFar;
			assert.notOk(stderr.includes('"jsonrpc"'));
			assert.notOk(stderr.includes('"method"'));
			// Pins the correct destination, not only the absence of protocol
			// bytes: with `Logger.LogToStderr` provided, the failing call's log
			// line lands here instead of on stdout (Critical finding 1).
			assert.ok(stderr.length > 0);
			yield* server.closeStdin;
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	// Cross-checks §5.7's envelope construction against the CLI's own
	// (`okfit validate --format json`) run over the same repo root, so a
	// drift between the two is caught. The warning count is NOT hard-coded
	// (contract gate 9; Task E1 changes it from ten to eleven): the two runs
	// are compared to each other rather than to a literal.
	it.effect("validate_bundle over the wire matches okfit validate's own exit_code and diagnostic counts", () =>
		Effect.gen(function* () {
			const server = yield* spawnMcp(ENV);
			yield* server.send(INITIALIZE);
			yield* readResponse(server, 1);
			yield* server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
			yield* server.send({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "validate_bundle", arguments: {} },
			});
			const response = (yield* readResponse(server, 2)) as {
				readonly result: {
					readonly structuredContent: {
						readonly exit_code: number;
						readonly summary: {
							readonly lint_warnings: number;
							readonly concepts: number;
							readonly conformance_errors: number;
						};
					};
				};
			};
			const envelope = response.result.structuredContent;
			yield* server.closeStdin;

			const cliOutput = execFileSync(process.execPath, [CLI_BIN, "validate", ".", "--format", "json"], {
				cwd: REPO_ROOT,
				env: { PATH: ENV.PATH, HOME: ENV.HOME, NO_COLOR: "1" },
				encoding: "utf8",
			});
			const cliEnvelope = JSON.parse(cliOutput) as {
				readonly exit_code: number;
				readonly summary: {
					readonly lint_warnings: number;
					readonly concepts: number;
					readonly conformance_errors: number;
				};
			};

			assert.strictEqual(envelope.exit_code, cliEnvelope.exit_code);
			assert.strictEqual(envelope.summary.lint_warnings, cliEnvelope.summary.lint_warnings);
			assert.strictEqual(envelope.summary.concepts, cliEnvelope.summary.concepts);
			assert.strictEqual(envelope.exit_code, 0);
			assert.strictEqual(envelope.summary.conformance_errors, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	// Settles contract §11 item 2 and N-8: stdin EOF ends `layerStdio`'s
	// scope and the process exits well within two seconds -- confirmed both
	// here and by a standalone spawn outside Vitest. N-8's escape hatch (an
	// explicit stdin `end` handler in `bin.ts`) is prescribed only if the
	// process does NOT exit within the window; it does, so that hatch is not
	// needed. Without a custom teardown the exit code would be 130:
	// `runMain`'s `defaultTeardown` (VERIFIED `effect/src/Runtime.ts:108-113`)
	// reports 130 whenever the main fiber's `Cause` contains only
	// interruptions and no failure/defect -- exactly what a stdin-EOF-driven
	// scope closure produces, since nothing in this server treats stdin
	// closing as a normal `Exit.succeed`. `bin.ts` maps that case to 0 via
	// `runMain`'s `teardown` option (review Minor finding 3), since 130
	// conventionally means "killed by SIGINT" and this is the ordinary end
	// of every session.
	it.effect("exits 0 within two seconds of stdin closing", () =>
		Effect.gen(function* () {
			const server = yield* spawnMcp(ENV);
			yield* server.send(INITIALIZE);
			yield* readResponse(server, 1);
			yield* server.closeStdin;
			const code = yield* server.exitCode.pipe(
				Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.fail("did not exit" as const) }),
			);
			assert.strictEqual(code, 0);
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);
});
