import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import type { ConceptsResult } from "../../src/features/concepts.js";
import { registerConcepts } from "../../src/features/concepts.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { makeCapturingTransport } from "../utils/fakeTransport.js";
import { testPlatform } from "../utils/platform.js";
import { setupRegistry, setupTwoFoldersRegistry } from "../utils/registryFixture.js";
import { makeTempBundle } from "../utils/tempBundle.js";

/**
 * `registerConcepts`'s single request handler: the `okfit/concepts` explorer
 * data every live session's last-loaded bundle answers with, wired against a
 * fake transport that only captures the registered handler (mirroring
 * `symbols.test.ts`'s harness).
 */

const platform = testPlatform();

const concept = (title: string, extra = ""): string => `---
type: Module
title: ${title}
${extra}generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# ${title}
`;

/** `[bundle] path = "."` puts the bundle root at the temp directory itself; off the two lint rules needing real git history. */
const CONFIG = `[bundle]
path = "."

[lint]
generated_at_drift = "off"
status_missing = "off"
`;

/** Builds a registry over a temp bundle, revalidates every live session, and returns a `call` bound to `registerConcepts`. */
const setup = (files: Readonly<Record<string, string>>) =>
	setupRegistry(registerConcepts, { ...files, ".okfit.toml": CONFIG });

describe("registerConcepts", () => {
	it.effect("lists every loaded concept with type, status and staleness, sorted by type then title", () =>
		Effect.gen(function* () {
			const { root, call } = yield* setup({
				"b.md": concept("Bravo", "status: draft\n"),
				"a.md": concept("Alpha", "stale_after: 2000-01-01T00:00:00Z\n"),
				"c.md": `---\ntype: Decision\ntitle: Charlie\ngenerated:\n  by: "human:fixture-author"\n  at: "2026-01-01T00:00:00Z"\n---\n\n# Charlie\n`,
			});
			const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
			assert.strictEqual(result.bundles.length, 1);
			const bundle = result.bundles[0]!;
			assert.strictEqual(bundle.root, root);
			assert.strictEqual(bundle.rootUri, pathToUri(root));
			assert.deepStrictEqual(
				bundle.concepts.map((c) => [c.type, c.title, c.status, c.stale]),
				[
					["Decision", "Charlie", undefined, false],
					["Module", "Alpha", undefined, true],
					["Module", "Bravo", "draft", false],
				],
			);
			assert.strictEqual(bundle.concepts[1]!.uri, pathToUri(`${root}/a.md`));
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("a concept with stale_after in the future is not stale", () =>
		Effect.gen(function* () {
			const { call } = yield* setup({ "a.md": concept("Alpha", "stale_after: 2999-01-01T00:00:00Z\n") });
			const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
			assert.strictEqual(result.bundles[0]!.concepts[0]!.stale, false);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect('maps the config\'s `profile = "none"` sentinel to undefined', () =>
		// `OkfitConfig.DEFAULTS.bundle.profile` is always "software-project" (`resolveProjectConfig` merges
		// `DEFAULTS < profile < file`), so leaving `profile` unset in the file never yields `undefined` --
		// only the explicit "none" sentinel (disabling profile merging) does, and this feature maps it.
		Effect.gen(function* () {
			const { call } = yield* setupRegistry(registerConcepts, {
				"a.md": concept("Alpha"),
				".okfit.toml": `[bundle]
path = "."
profile = "none"

[lint]
generated_at_drift = "off"
status_missing = "off"
`,
			});
			const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
			assert.strictEqual(result.bundles[0]!.profile, undefined);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("reports the default profile name when the config leaves it unset", () =>
		Effect.gen(function* () {
			const { call } = yield* setup({ "a.md": concept("Alpha") });
			const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
			assert.strictEqual(result.bundles[0]!.profile, "software-project");
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("reports the configured profile name unchanged when it differs from the default", () =>
		// Both other non-"none" cases above resolve to "software-project" -- the unset case because it is
		// `OkfitConfig.DEFAULTS.bundle.profile`, and a mutant that hardcoded that string would still pass
		// them. An unrecognized profile name merges only `DEFAULTS < file` (`resolveProjectConfig` logs a
		// warning and falls back to `DEFAULTS` as `base` when the name doesn't resolve to a real profile),
		// but the file's own literal `bundle.profile` value survives that merge unchanged, so this still
		// exercises a real, distinct round trip through `session.config()` without needing a second real
		// profile package.
		Effect.gen(function* () {
			const { call } = yield* setupRegistry(registerConcepts, {
				"a.md": concept("Alpha"),
				".okfit.toml": `[bundle]
path = "."
profile = "docs-only"

[lint]
generated_at_drift = "off"
status_missing = "off"
`,
			});
			const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
			assert.strictEqual(result.bundles[0]!.profile, "docs-only");
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("a session whose bundle never loaded contributes no entry", () =>
		Effect.gen(function* () {
			const { root } = yield* makeTempBundle({ ".okfit.toml": CONFIG });
			const { transport, call } = makeCapturingTransport();
			const registry = yield* makeSessionRegistry({
				delay: "10 millis",
				maxWait: "10 seconds",
				onRevalidate: () => Effect.void,
				onDispose: () => Effect.void,
			});
			yield* registerConcepts(transport, registry);
			yield* registry.setFolders([root]);
			// No revalidate: bundle() is None.
			const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
			assert.deepStrictEqual(result.bundles, []);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect(
		"two workspace folders, each its own bundle: two bundles entries, sorted by root, each with only its own concepts",
		() =>
			Effect.gen(function* () {
				const { rootA, rootB, call } = yield* setupTwoFoldersRegistry(
					registerConcepts,
					{ "alpha.md": concept("Alpha"), ".okfit.toml": CONFIG },
					{ "bravo.md": concept("Bravo"), ".okfit.toml": CONFIG },
				);
				const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
				assert.strictEqual(result.bundles.length, 2);
				const [sortedA, sortedB] = [rootA, rootB].toSorted();
				assert.deepStrictEqual(
					result.bundles.map((b) => b.root),
					[sortedA, sortedB],
				);
				const bundleA = result.bundles.find((b) => b.root === rootA)!;
				const bundleB = result.bundles.find((b) => b.root === rootB)!;
				assert.deepStrictEqual(
					bundleA.concepts.map((c) => c.title),
					["Alpha"],
				);
				assert.deepStrictEqual(
					bundleB.concepts.map((c) => c.title),
					["Bravo"],
				);
			}).pipe(Effect.scoped, Effect.provide(platform)),
	);
});
