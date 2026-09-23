import { assert, describe, it } from "@effect/vitest";
import { Effect, Logger } from "effect";
import { pathToUri } from "../../src/convert/uri.js";
import type { ConceptsResult } from "../../src/features/concepts.js";
import { registerConcepts } from "../../src/features/concepts.js";
import { testPlatform } from "../utils/platform.js";
import { setupRegistry, setupTwoFoldersRegistry, setupWarmupRegistry } from "../utils/registryFixture.js";
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

	// The old "a session whose bundle never loaded contributes no entry" case is no longer reachable:
	// `registerConcepts` now warms up every workspace folder before answering, so a folder whose config
	// resolves gets its session built and a first `full` revalidate run before the handler answers. The
	// warm-up cases below replace it.

	// `it.live`, not `it.effect`: the warm-up runs the real scheduler (`schedule` then `settle`), which
	// sleeps out the (real, 10ms) debounce delay -- under `it.effect`'s virtual `TestClock`, which nothing
	// here advances, that sleep never resolves and the test hangs until it times out.
	it.live("warms up a folder that has no session yet", () =>
		Effect.gen(function* () {
			const { root } = yield* makeTempBundle({ "a.md": concept("Alpha"), ".okfit.toml": CONFIG });
			const { call, notifications, registry } = yield* setupWarmupRegistry(registerConcepts);
			// No sessionFor/revalidate call before the request: the folder has never been resolved.
			yield* registry.setFolders([root]);
			const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
			assert.strictEqual(result.bundles.length, 1);
			assert.strictEqual(result.bundles[0]!.root, root);
			assert.deepStrictEqual(
				result.bundles[0]!.concepts.map((c) => c.title),
				["Alpha"],
			);
			// The warm-up went through the normal scheduler path (publish, then notify), not a bypass.
			assert.isTrue(
				notifications.some((n) => n.method === "textDocument/publishDiagnostics" || n.method === "okfit/bundleChanged"),
			);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.live("a folder without an okfit config contributes nothing and does not fail", () =>
		// `plain` has no `.okfit.toml` anywhere upward of it, so config resolution falls back to
		// `OkfitConfig.DEFAULTS` (`bundle.path: "okf"`) rather than failing outright; the warm-up still
		// builds a session for it, but that session's bundle root (`plain/okf`) does not exist on disk, so
		// its revalidate fails and logs a warning (expected here, hence the silenced logger) and contributes
		// no bundle entry -- exactly like a folder whose config genuinely failed to parse.
		Effect.gen(function* () {
			const { root: plain } = yield* makeTempBundle({ "README.md": "# plain\n" });
			const { root: bundleRoot } = yield* makeTempBundle({ "a.md": concept("Alpha"), ".okfit.toml": CONFIG });
			const { call, registry } = yield* setupWarmupRegistry(registerConcepts);
			yield* registry.setFolders([plain, bundleRoot]);
			const result = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
			assert.strictEqual(result.bundles.length, 1);
			assert.strictEqual(result.bundles[0]!.root, bundleRoot);
		}).pipe(Effect.scoped, Effect.provide(platform), Effect.provide(Logger.layer([]))),
	);

	describe("once-per-root warm-up (Task 11 Part B)", () => {
		it.live("a root whose bundle fails to load is revalidated once across two consecutive requests", () =>
			Effect.gen(function* () {
				const { root: plain } = yield* makeTempBundle({ "README.md": "# plain\n" });
				const { call, notifications, registry } = yield* setupWarmupRegistry(registerConcepts);
				yield* registry.setFolders([plain]);
				yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
				const firstCount = notifications.filter((n) => n.method === "okfit/bundleChanged").length;
				yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
				const secondCount = notifications.filter((n) => n.method === "okfit/bundleChanged").length;
				assert.strictEqual(firstCount, 1);
				assert.strictEqual(secondCount, 1);
			}).pipe(Effect.scoped, Effect.provide(platform), Effect.provide(Logger.layer([]))),
		);

		it.live("a rebuild of a failed root gives it another warm-up attempt", () =>
			Effect.gen(function* () {
				const { root: plain } = yield* makeTempBundle({ "README.md": "# plain\n" });
				const { call, notifications, registry } = yield* setupWarmupRegistry(registerConcepts);
				yield* registry.setFolders([plain]);
				yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
				assert.strictEqual(notifications.filter((n) => n.method === "okfit/bundleChanged").length, 1);
				const bundleRoot = `${plain}/okf`;
				yield* registry.rebuild(bundleRoot);
				const afterRebuild = notifications.filter((n) => n.method === "okfit/bundleChanged").length;
				assert.isAbove(afterRebuild, 1);
			}).pipe(Effect.scoped, Effect.provide(platform), Effect.provide(Logger.layer([]))),
		);

		it.effect("a healthy root is still answered on both requests", () =>
			Effect.gen(function* () {
				const { root, call } = yield* setup({ "a.md": concept("Alpha") });
				const first = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
				const second = yield* call<Record<string, never>, ConceptsResult>("okfit/concepts", {});
				assert.strictEqual(first.bundles[0]!.root, root);
				assert.strictEqual(second.bundles[0]!.root, root);
				assert.deepStrictEqual(
					second.bundles[0]!.concepts.map((c) => c.title),
					["Alpha"],
				);
			}).pipe(Effect.scoped, Effect.provide(platform)),
		);
	});

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
