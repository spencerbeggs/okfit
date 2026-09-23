import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { registerWorkspaceSymbols } from "../../src/features/symbols.js";
import type { LspTransportShape } from "../../src/protocol/LspTransport.js";
import type { SymbolInformation, WorkspaceSymbolParams } from "../../src/protocol/types.js";
import { SYMBOL_KIND_OBJECT } from "../../src/protocol/types.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { testPlatform } from "../utils/platform.js";
import { makeTempBundle } from "../utils/tempBundle.js";

/**
 * `registerWorkspaceSymbols`'s single handler, task 6 of the phase 4 plan
 * (decision 7). Wired against a fake transport that only captures the
 * registered handler (no JSON-RPC round trip), mirroring
 * `navigation.test.ts`'s harness: `session.revalidate` is called directly on
 * every live session so `bundle()` is populated, no scheduler involved.
 */

const platform = testPlatform();

const die = (name: string) => (): Effect.Effect<never> =>
	Effect.die(`fake transport: ${name} is not used by this test`);

/** A transport whose `onRequest` records each handler by method; every other member dies if called. */
const makeCapturingTransport = (): {
	readonly transport: LspTransportShape;
	readonly call: <P, R>(method: string, params: P) => Effect.Effect<R>;
} => {
	const handlers = new Map<string, (params: unknown) => Effect.Effect<unknown>>();
	const transport = {
		onInitialize: die("onInitialize"),
		onInitialized: die("onInitialized"),
		onShutdown: die("onShutdown"),
		onRequest: (method: string, handler: (params: unknown) => Effect.Effect<unknown>) =>
			Effect.sync(() => void handlers.set(method, handler)),
		onNotification: die("onNotification"),
		sendNotification: die("sendNotification"),
		sendRequest: die("sendRequest"),
		listen: Effect.die("fake transport: listen is not used by this test"),
	} as unknown as LspTransportShape;
	const call = <P, R>(method: string, params: P): Effect.Effect<R> => {
		const handler = handlers.get(method);
		return handler === undefined
			? Effect.die(`no handler registered for ${method}`)
			: (handler(params) as Effect.Effect<R>);
	};
	return { transport, call };
};

const concept = (title: string): string => `---
type: Module
title: ${title}
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# ${title}
`;

/** `[bundle] path = "."` puts the bundle root at the temp directory itself, so `makeTempBundle`'s flat file map needs no `okf/` prefix; off the two lint rules that need real git history, which this synthetic tree has none of. */
const CONFIG = `[bundle]
path = "."

[lint]
generated_at_drift = "off"
status_missing = "off"
`;

/** Builds a registry over a temp bundle, revalidates every live session, and returns a `call` bound to `registerWorkspaceSymbols`. */
const setup = (files: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const { root } = yield* makeTempBundle({ ...files, ".okfit.toml": CONFIG });
		const { transport, call } = makeCapturingTransport();
		const registry = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: () => Effect.void,
			onDispose: () => Effect.void,
		});
		yield* registerWorkspaceSymbols(transport, registry);
		yield* registry.setFolders([root]);
		// Any path under root resolves to the one session this bundle owns.
		const handle = Option.getOrThrow(yield* registry.sessionFor(root));
		const now = yield* DateTime.now;
		yield* handle.session.revalidate({ now, tier: "full" });
		return { root, call };
	});

describe("registerWorkspaceSymbols", () => {
	it.effect("an empty query returns every concept, sorted by id", () =>
		Effect.gen(function* () {
			const { call } = yield* setup({
				"b.md": concept("Bravo"),
				"a.md": concept("Alpha"),
				"c.md": concept("Charlie"),
			});
			const symbols = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
				query: "",
			});
			assert.deepStrictEqual(
				symbols.map((symbol) => symbol.name),
				["Alpha", "Bravo", "Charlie"],
			);
			assert.strictEqual(symbols[0]?.kind, SYMBOL_KIND_OBJECT);
			assert.strictEqual(symbols[0]?.containerName, "Module");
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("a substring query matches by id or by title, case-insensitively", () =>
		Effect.gen(function* () {
			const { call } = yield* setup({
				"apple.md": concept("Apple"),
				"banana.md": concept("A Fruity Banana"),
				"carrot.md": concept("Carrot"),
			});
			const byId = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
				query: "APPLE",
			});
			assert.deepStrictEqual(
				byId.map((symbol) => symbol.name),
				["Apple"],
			);

			const byTitle = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
				query: "fruity",
			});
			assert.deepStrictEqual(
				byTitle.map((symbol) => symbol.name),
				["A Fruity Banana"],
			);
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("a query matching nothing answers [] (beside the control above)", () =>
		Effect.gen(function* () {
			const { call } = yield* setup({ "a.md": concept("Alpha") });
			const symbols = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
				query: "nonexistent-needle",
			});
			assert.deepStrictEqual(symbols, []);

			const control = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
				query: "Alpha",
			});
			assert.strictEqual(control.length, 1);
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect("results are capped at 200 even when more concepts match", () =>
		Effect.gen(function* () {
			const files: Record<string, string> = {};
			for (let index = 0; index < 250; index++) {
				const id = String(index).padStart(3, "0");
				files[`c-${id}.md`] = concept(`Concept ${id}`);
			}
			const { call } = yield* setup(files);
			const symbols = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
				query: "",
			});
			assert.strictEqual(symbols.length, 200);
		}).pipe(Effect.provide(platform), Effect.scoped),
	);
});
