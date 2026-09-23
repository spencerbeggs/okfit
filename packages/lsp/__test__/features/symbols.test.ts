import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import { registerWorkspaceSymbols } from "../../src/features/symbols.js";
import type { SymbolInformation, WorkspaceSymbolParams } from "../../src/protocol/types.js";
import { SYMBOL_KIND_OBJECT } from "../../src/protocol/types.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { makeCapturingTransport } from "../utils/fakeTransport.js";
import { testPlatform } from "../utils/platform.js";
import { setupRegistry } from "../utils/registryFixture.js";
import { makeTempBundle } from "../utils/tempBundle.js";

/**
 * `registerWorkspaceSymbols`'s single handler, task 6 of the phase 4 plan
 * (decision 7). Wired against a fake transport that only captures the
 * registered handler (no JSON-RPC round trip), mirroring
 * `navigation.test.ts`'s harness: `session.revalidate` is called directly on
 * every live session so `bundle()` is populated, no scheduler involved.
 */

const platform = testPlatform();

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
	setupRegistry(registerWorkspaceSymbols, { ...files, ".okfit.toml": CONFIG });

/** Two independent temp bundles, each its own workspace folder, both revalidated; returns a `call` bound across both live sessions. */
const setupTwoFolders = (filesA: Readonly<Record<string, string>>, filesB: Readonly<Record<string, string>>) =>
	Effect.gen(function* () {
		const { root: rootA } = yield* makeTempBundle({ ...filesA, ".okfit.toml": CONFIG });
		const { root: rootB } = yield* makeTempBundle({ ...filesB, ".okfit.toml": CONFIG });
		const { transport, call } = makeCapturingTransport();
		const registry = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: () => Effect.void,
			onDispose: () => Effect.void,
		});
		yield* registerWorkspaceSymbols(transport, registry);
		yield* registry.setFolders([rootA, rootB]);
		for (const root of [rootA, rootB]) {
			const handle = Option.getOrThrow(yield* registry.sessionFor(root));
			const now = yield* DateTime.now;
			yield* handle.session.revalidate({ now, tier: "full" });
		}
		return { rootA, rootB, call };
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

	it.effect(
		"two workspace folders, each with its own bundle: an empty query returns concepts from both (a query matching only one bundle's concept returns that one, control below)",
		() =>
			Effect.gen(function* () {
				const { call } = yield* setupTwoFolders({ "alpha.md": concept("Alpha") }, { "bravo.md": concept("Bravo") });

				const all = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
					query: "",
				});
				assert.deepStrictEqual(all.map((symbol) => symbol.name).toSorted(), ["Alpha", "Bravo"]);

				const onlyOne = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
					query: "Alpha",
				});
				assert.deepStrictEqual(
					onlyOne.map((symbol) => symbol.name),
					["Alpha"],
				);
			}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect(
		"two bundles each carrying the same id (`project`) are two symbols, one per definition URI; a title matching only one returns that one (control)",
		() =>
			Effect.gen(function* () {
				const { rootA, rootB, call } = yield* setupTwoFolders(
					{ "project.md": concept("First Project") },
					{ "project.md": concept("Second Project") },
				);
				const all = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
					query: "project",
				});
				assert.deepStrictEqual(all.map((symbol) => symbol.name).toSorted(), ["First Project", "Second Project"]);
				assert.deepStrictEqual(
					all.map((symbol) => symbol.location.uri).toSorted(),
					[pathToUri(`${rootA}/project.md`), pathToUri(`${rootB}/project.md`)].toSorted(),
				);

				const onlyOne = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
					query: "Second",
				});
				assert.deepStrictEqual(
					onlyOne.map((symbol) => symbol.name),
					["Second Project"],
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

	it.effect(
		"results are capped at 200 even when more concepts match, keeping the lexicographically smallest 200 ids in order",
		() =>
			Effect.gen(function* () {
				const ids: Array<string> = [];
				const files: Record<string, string> = {};
				for (let index = 0; index < 250; index++) {
					const id = String(index).padStart(3, "0");
					ids.push(`c-${id}`);
					files[`c-${id}.md`] = concept(`Concept ${id}`);
				}
				const { call } = yield* setup(files);
				const symbols = yield* call<WorkspaceSymbolParams, ReadonlyArray<SymbolInformation>>("workspace/symbol", {
					query: "",
				});
				assert.strictEqual(symbols.length, 200);

				const expectedIds = [...ids].sort().slice(0, 200);
				const expectedNames = expectedIds.map((id) => `Concept ${id.slice(2)}`);
				assert.deepStrictEqual(
					symbols.map((symbol) => symbol.name),
					expectedNames,
				);
			}).pipe(Effect.provide(platform), Effect.scoped),
	);
});
