import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { SERVER_INSTRUCTIONS } from "../src/index.js";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import type { DiscoverResult, ProtocolVersion } from "./utils/harness.js";
import { makeHarness } from "./utils/harness.js";

const ALL_VERSIONS: ReadonlyArray<ProtocolVersion> = ["2026-07-28", "2025-11-25", "2025-06-18"];
const STATEFUL_VERSIONS: ReadonlyArray<ProtocolVersion> = ["2025-11-25", "2025-06-18"];

const open = (protocolVersion: ProtocolVersion) =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject("project");
		return yield* makeHarness(root, { protocolVersion });
	});

interface InitializeResult {
	readonly protocolVersion: string;
	readonly instructions?: string;
	readonly serverInfo: { readonly name: string; readonly version: string };
	readonly capabilities: Record<string, unknown>;
}

interface StatelessFrame {
	readonly _meta?: { readonly "io.modelcontextprotocol/serverInfo"?: { readonly name: string } };
	readonly resultType?: string;
}

describe("protocol 2026-07-28 (stateless)", () => {
	it.effect("server/discover advertises every adapter, stateless first, and the instructions verbatim", () =>
		Effect.gen(function* () {
			const harness = yield* open("2026-07-28");
			const response = yield* harness.discover;
			assert.isUndefined(response.error);
			const result = response.result as DiscoverResult;
			// Every listed adapter is advertised, not only the stateless one
			// (Effect's runtime builds `supportedVersions` from the whole
			// `protocols` array), and array order is preserved.
			assert.deepStrictEqual(result.supportedVersions, ALL_VERSIONS);
			assert.strictEqual(result.instructions, SERVER_INSTRUCTIONS);
			const serverInfo = result._meta?.["io.modelcontextprotocol/serverInfo"] as { readonly name: string };
			assert.strictEqual(serverInfo.name, "okfit");
			assert.strictEqual(result.resultType, "complete");
			assert.ok(result.capabilities.tools);
			assert.ok(result.capabilities.resources);
		}).pipe(Effect.scoped),
	);

	it.effect("tools/list answers with no handshake at all", () =>
		Effect.gen(function* () {
			const harness = yield* open("2026-07-28");
			const tools = yield* harness.listTools;
			assert.strictEqual(tools.length, 6);
			assert.ok(tools.some((tool) => tool.name === "get_concept"));
		}).pipe(Effect.scoped),
	);

	it.effect("initialize routed to the stateless adapter is METHOD_NOT_FOUND", () =>
		Effect.gen(function* () {
			const harness = yield* open("2026-07-28");
			// The `_meta` routes this frame to the stateless adapter, which does
			// not implement `initialize` (SEP-2575). A bare `initialize` with no
			// `_meta` matches stateful adapters only -- the stateless adapter at
			// `protocols[0]` never captures it -- which the stateful suite below
			// proves by opening with `initialize` against the same server.
			const response = yield* harness.sendRequest("initialize", {
				protocolVersion: "2026-07-28",
				capabilities: {},
				clientInfo: { name: "okfit-test", version: "0.0.0" },
			});
			assert.isUndefined(response.result);
			assert.strictEqual((response.error as { readonly code: number }).code, -32601);
		}).pipe(Effect.scoped),
	);

	it.effect("every tools/call result is wrapped in the stateless frame", () =>
		Effect.gen(function* () {
			const harness = yield* open("2026-07-28");
			const response = yield* harness.sendRequest("tools/call", {
				name: "get_concept",
				arguments: { id: "metrics/revenue" },
			});
			const frame = response.result as StatelessFrame;
			assert.strictEqual(frame.resultType, "complete");
			assert.strictEqual(frame._meta?.["io.modelcontextprotocol/serverInfo"]?.name, "okfit");
		}).pipe(Effect.scoped),
	);
});

describe("stateful adapters", () => {
	for (const version of STATEFUL_VERSIONS) {
		it.effect(`initialize on ${version} negotiates that version and carries the instructions verbatim`, () =>
			Effect.gen(function* () {
				const harness = yield* open(version);
				const response = yield* harness.initialize;
				assert.isUndefined(response.error);
				const result = response.result as InitializeResult;
				assert.strictEqual(result.protocolVersion, version);
				assert.strictEqual(result.instructions, SERVER_INSTRUCTIONS);
				assert.strictEqual(result.serverInfo.name, "okfit");
			}).pipe(Effect.scoped),
		);
	}
});

// The revision x outcome matrix. The three outcomes are the ones a client
// can distinguish on the wire; the one per-revision difference is how
// invalid params surface, and that is the runtime's own split by protocol
// version, encoded here rather than papered over.
describe("revision x outcome matrix", () => {
	for (const version of ALL_VERSIONS) {
		describe(version, () => {
			it.effect("success carries structuredContent and a JSON rendering in content[0].text", () =>
				Effect.gen(function* () {
					const harness = yield* open(version);
					yield* harness.initialize;
					const result = yield* harness.callTool("get_concept", { id: "metrics/revenue" });
					assert.notOk(result.isError);
					assert.strictEqual((result.structuredContent as { readonly id: string }).id, "metrics/revenue");
					assert.strictEqual(result.content[0]?.type, "text");
					assert.deepStrictEqual(JSON.parse(result.content[0]?.text ?? ""), result.structuredContent);
				}).pipe(Effect.scoped),
			);

			it.effect("a declared failure is isError with the message in content[0].text and no structuredContent", () =>
				Effect.gen(function* () {
					const harness = yield* open(version);
					yield* harness.initialize;
					const result = yield* harness.callTool("get_concept", { id: "nope" });
					assert.strictEqual(result.isError, true);
					assert.isUndefined(result.structuredContent);
					assert.strictEqual(result.content.length, 1);
					assert.ok(result.content[0]?.text?.includes("nope"));
					assert.ok(result.content[0]?.text?.includes("Try list_concepts."));
				}).pipe(Effect.scoped),
			);

			it.effect(
				version === "2025-06-18"
					? "invalid params is a JSON-RPC -32602 error"
					: "invalid params is an isError: true result, not a JSON-RPC error",
				() =>
					Effect.gen(function* () {
						const harness = yield* open(version);
						yield* harness.initialize;
						const response = yield* harness.sendRequest("tools/call", {
							name: "get_concept",
							arguments: { id: 123 },
						});
						if (version === "2025-06-18") {
							assert.isUndefined(response.result);
							assert.strictEqual((response.error as { readonly code: number }).code, -32602);
						} else {
							assert.isUndefined(response.error);
							const result = response.result as { readonly isError?: boolean; readonly structuredContent?: unknown };
							assert.strictEqual(result.isError, true);
							assert.isUndefined(result.structuredContent);
						}
					}).pipe(Effect.scoped),
			);
		});
	}
});
