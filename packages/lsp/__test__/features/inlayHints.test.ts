import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MarkdownDocument } from "@effected/markdown";
import { Actor, Concept, DiagnosticRange, Verification } from "@okfit/core";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { toLspRange } from "../../src/convert/range.js";
import { pathToUri } from "../../src/convert/uri.js";
import { hintsFor, registerInlayHints } from "../../src/features/inlayHints.js";
import type { InlayHint, InlayHintParams } from "../../src/protocol/types.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { makeCapturingTransport } from "../utils/fakeTransport.js";
import { copyFixtureProject } from "../utils/fixture.js";
import { testPlatform } from "../utils/platform.js";

/**
 * `hintsFor`, task 5 of the LSP-actions plan: the pure trust/staleness and
 * generated-age computation `registerInlayHints` positions against the live
 * document. No session or document needed here -- `__test__/utils/harness.ts`
 * covers position resolution separately.
 */

type ConceptInput = Parameters<typeof Concept.make>[0];
const decodeActor = Schema.decodeUnknownSync(Actor);
const concept = (fields: Omit<ConceptInput, "type" | "extensions" | "raw">): Concept =>
	Concept.make({ type: "Module", extensions: {}, raw: {}, ...fields });
const verifiedBy = (by: string, at: string): Verification =>
	Verification.make({ by: decodeActor(by), at: DateTime.makeUnsafe(at) });

const NOW = DateTime.makeUnsafe("2026-09-23T00:00:00Z");

describe("hintsFor", () => {
	it.effect("unverified, fresh: `unverified`, anchored on the explicit `status` field", () =>
		Effect.sync(() => {
			const hints = hintsFor(concept({ status: "stable" }), NOW);
			assert.deepStrictEqual(hints, [{ path: ["status"], label: "unverified" }]);
		}),
	);

	it.effect("human-reviewed: labels the newest `human:` entry's `by`, ignoring an older human entry", () =>
		Effect.sync(() => {
			const hints = hintsFor(
				concept({
					status: "stable",
					verified: [
						verifiedBy("human:alice", "2026-01-01T00:00:00Z"),
						verifiedBy("human:bob", "2026-06-01T00:00:00Z"),
					],
				}),
				NOW,
			);
			assert.deepStrictEqual(hints, [{ path: ["status"], label: "human-reviewed by human:bob" }]);
		}),
	);

	it.effect("machine-confirmed: a non-human `verified` entry, no actor named", () =>
		Effect.sync(() => {
			const hints = hintsFor(
				concept({ status: "stable", verified: [verifiedBy("process:ci", "2026-01-01T00:00:00Z")] }),
				NOW,
			);
			assert.deepStrictEqual(hints, [{ path: ["status"], label: "machine-confirmed" }]);
		}),
	);

	it.effect("stale: appends ` · stale` to the trust label when `Derive.isStale` is true", () =>
		Effect.sync(() => {
			const hints = hintsFor(
				concept({ status: "stable", stale_after: DateTime.makeUnsafe("2026-01-01T00:00:00Z") }),
				NOW,
			);
			assert.deepStrictEqual(hints, [{ path: ["status"], label: "unverified · stale" }]);
		}),
	);

	it.effect("absent `status`: the trust hint anchors on `type` instead", () =>
		Effect.sync(() => {
			const hints = hintsFor(concept({}), NOW);
			assert.deepStrictEqual(hints, [{ path: ["type"], label: "unverified" }]);
		}),
	);

	it.effect("absent `generated`: no second hint", () =>
		Effect.sync(() => {
			const hints = hintsFor(concept({ status: "stable" }), NOW);
			assert.strictEqual(hints.length, 1);
		}),
	);

	it.effect("`generated.at` 3 days before now: `3 days ago`", () =>
		Effect.sync(() => {
			const hints = hintsFor(
				concept({
					status: "stable",
					generated: { by: decodeActor("human:fixture-author"), at: DateTime.makeUnsafe("2026-09-20T00:00:00Z") },
				}),
				NOW,
			);
			assert.deepStrictEqual(hints[1], { path: ["generated", "at"], label: "3 days ago" });
		}),
	);

	it.effect("`generated.at` under one day before now: `today`", () =>
		Effect.sync(() => {
			const hints = hintsFor(
				concept({
					status: "stable",
					generated: { by: decodeActor("human:fixture-author"), at: DateTime.makeUnsafe("2026-09-22T12:00:00Z") },
				}),
				NOW,
			);
			assert.deepStrictEqual(hints[1], { path: ["generated", "at"], label: "today" });
		}),
	);

	it.effect("`generated.at` exactly 1 day before now: `1 day ago`", () =>
		Effect.sync(() => {
			const hints = hintsFor(
				concept({
					status: "stable",
					generated: { by: decodeActor("human:fixture-author"), at: DateTime.makeUnsafe("2026-09-22T00:00:00Z") },
				}),
				NOW,
			);
			assert.deepStrictEqual(hints[1], { path: ["generated", "at"], label: "1 day ago" });
		}),
	);
});

const platform = testPlatform();

const STATUS_SOURCE = `---
type: Module
title: Status Concept
description: A tiny synthetic concept used only by @okfit/lsp's own inlay hint tests.
status: stable
generated:
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
---

# Status Concept

Nothing here is read by production code.
`;

/**
 * `generated` block present but with no `at` key: `["generated", "at"]`
 * decodes to `undefined` on the concept itself (D-15's `optionalKey`), so
 * `hintsFor` never emits that spec in the first place -- exercising the
 * end-to-end absence through the full request handler, not just the pure
 * `hintsFor` case already covered above.
 */
const GENERATED_NO_AT_SOURCE = `---
type: Module
title: Generated Without At
description: A tiny synthetic concept used only by @okfit/lsp's own inlay hint tests.
status: stable
generated:
  by: "human:fixture-author"
---

# Generated Without At

Nothing here is read by production code.
`;

/**
 * A YAML anchor/alias shape: `generated` is `*g`, an alias to the anchor
 * `provenance` defines. `Yaml.parse` (the frontmatter decoder `Bundle.ts`
 * uses) resolves aliases when building the plain JS value handed to the
 * concept schema -- `generated.at` decodes present, so `hintsFor` emits the
 * `generated.at` spec -- but `YamlDocument.find` (what
 * `DiagnosticRange.forFrontmatterPath` walks) does not follow an alias node:
 * `find(["generated", "at"])` reaches the `YamlAlias` node at `generated` and
 * stops, since it is not a `YamlMap`, so the lookup falls back to the whole
 * frontmatter block. This is the one document shape in this feature's field
 * set that reaches `registerInlayHints`'s `isFallback` branch rather than the
 * `range === undefined` one: probed directly against
 * `DiagnosticRange.forFrontmatterPath` before writing this case (`genAt`
 * equals `whole`, `status` resolves normally).
 */
const ALIASED_GENERATED_SOURCE = `---
type: Module
title: Aliased Generated
description: A tiny synthetic concept used only by @okfit/lsp's own inlay hint tests.
status: stable
provenance: &g
  by: "human:fixture-author"
  at: "2026-01-01T00:00:00Z"
generated: *g
---

# Aliased Generated

Nothing here is read by production code.
`;

describe("registerInlayHints", () => {
	it.effect("`textDocument/inlayHint` positions the trust hint at the end of `status`'s own value range", () =>
		Effect.gen(function* () {
			const { root } = yield* copyFixtureProject();
			const conceptPath = join(root, "okf", "modules", "status.md");
			yield* Effect.promise(() => writeFile(conceptPath, STATUS_SOURCE, "utf8"));

			const { transport, call } = makeCapturingTransport();
			const registry = yield* makeSessionRegistry({
				delay: "10 millis",
				maxWait: "10 seconds",
				onRevalidate: () => Effect.void,
				onDispose: () => Effect.void,
			});
			yield* registerInlayHints(transport, registry);
			yield* registry.setFolders([root]);

			const handle = Option.getOrThrow(yield* registry.sessionFor(conceptPath));
			yield* handle.session.open(conceptPath, STATUS_SOURCE, 1);
			const now = yield* DateTime.now;
			yield* handle.session.revalidate({ now, tier: "full" });

			const hints = yield* call<InlayHintParams, ReadonlyArray<InlayHint>>("textDocument/inlayHint", {
				textDocument: { uri: pathToUri(conceptPath) },
				range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
			});

			const document = Result.getOrThrow(MarkdownDocument.parseResult(STATUS_SOURCE, { frontmatter: true }));
			const expectedRange = DiagnosticRange.forFrontmatterPath(document, ["status"]);
			if (expectedRange === undefined) throw new Error("expected a `status` range in the fixture source");
			const expectedPosition = toLspRange(STATUS_SOURCE, expectedRange).end;

			const statusHint = hints.find(
				(hint) =>
					hint.position.line === expectedPosition.line && hint.position.character === expectedPosition.character,
			);
			assert.isDefined(statusHint);

			// Positive control for the leaf-absent fallback below: a resolvable
			// `generated.at` yields the age hint too, so its absence there is a
			// property of the missing key, not of the handler dropping every
			// second hint unconditionally.
			assert.strictEqual(hints.length, 2);
		}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect(
		"a `generated` block with no `at` key: the generated-age hint is dropped, the status hint still resolves",
		() =>
			Effect.gen(function* () {
				const { root } = yield* copyFixtureProject();
				const conceptPath = join(root, "okf", "modules", "status.md");
				yield* Effect.promise(() => writeFile(conceptPath, GENERATED_NO_AT_SOURCE, "utf8"));

				const { transport, call } = makeCapturingTransport();
				const registry = yield* makeSessionRegistry({
					delay: "10 millis",
					maxWait: "10 seconds",
					onRevalidate: () => Effect.void,
					onDispose: () => Effect.void,
				});
				yield* registerInlayHints(transport, registry);
				yield* registry.setFolders([root]);

				const handle = Option.getOrThrow(yield* registry.sessionFor(conceptPath));
				yield* handle.session.open(conceptPath, GENERATED_NO_AT_SOURCE, 1);
				const now = yield* DateTime.now;
				yield* handle.session.revalidate({ now, tier: "full" });

				const hints = yield* call<InlayHintParams, ReadonlyArray<InlayHint>>("textDocument/inlayHint", {
					textDocument: { uri: pathToUri(conceptPath) },
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
				});

				// `concept.frontmatter.generated.at` decodes to `undefined` when the
				// key is absent (D-15's `optionalKey`), so `hintsFor` never emits the
				// generated-age spec at all here -- this proves the end-to-end
				// absence through the full request handler, not just `hintsFor`'s own
				// pure "absent `generated`: no second hint" case.
				assert.strictEqual(hints.length, 1);

				const document = Result.getOrThrow(MarkdownDocument.parseResult(GENERATED_NO_AT_SOURCE, { frontmatter: true }));
				const expectedRange = DiagnosticRange.forFrontmatterPath(document, ["status"]);
				if (expectedRange === undefined) throw new Error("expected a `status` range in the fixture source");
				const expectedPosition = toLspRange(GENERATED_NO_AT_SOURCE, expectedRange).end;

				assert.strictEqual(hints[0]?.position.line, expectedPosition.line);
				assert.strictEqual(hints[0]?.position.character, expectedPosition.character);
			}).pipe(Effect.provide(platform), Effect.scoped),
	);

	it.effect(
		"`generated` aliased to an anchored field: the generated-age hint is dropped by the block-fallback guard, not by `hintsFor` never emitting it",
		() =>
			Effect.gen(function* () {
				const { root } = yield* copyFixtureProject();
				const conceptPath = join(root, "okf", "modules", "status.md");
				yield* Effect.promise(() => writeFile(conceptPath, ALIASED_GENERATED_SOURCE, "utf8"));

				const { transport, call } = makeCapturingTransport();
				const registry = yield* makeSessionRegistry({
					delay: "10 millis",
					maxWait: "10 seconds",
					onRevalidate: () => Effect.void,
					onDispose: () => Effect.void,
				});
				yield* registerInlayHints(transport, registry);
				yield* registry.setFolders([root]);

				const handle = Option.getOrThrow(yield* registry.sessionFor(conceptPath));
				yield* handle.session.open(conceptPath, ALIASED_GENERATED_SOURCE, 1);
				const now = yield* DateTime.now;
				yield* handle.session.revalidate({ now, tier: "full" });

				const hints = yield* call<InlayHintParams, ReadonlyArray<InlayHint>>("textDocument/inlayHint", {
					textDocument: { uri: pathToUri(conceptPath) },
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
				});

				// `generated` decodes here (the yaml frontmatter decoder resolves the
				// alias, so `concept.frontmatter.generated.at` is present and
				// `hintsFor` emits the `generated.at` spec) -- so a single hint means
				// `registerInlayHints`'s `isFallback` guard dropped it after
				// `DiagnosticRange.forFrontmatterPath` fell back to the whole
				// frontmatter block, not that the spec was never emitted.
				assert.strictEqual(hints.length, 1);

				const document = Result.getOrThrow(
					MarkdownDocument.parseResult(ALIASED_GENERATED_SOURCE, { frontmatter: true }),
				);
				const expectedRange = DiagnosticRange.forFrontmatterPath(document, ["status"]);
				if (expectedRange === undefined) throw new Error("expected a `status` range in the fixture source");
				const expectedPosition = toLspRange(ALIASED_GENERATED_SOURCE, expectedRange).end;

				assert.strictEqual(hints[0]?.position.line, expectedPosition.line);
				assert.strictEqual(hints[0]?.position.character, expectedPosition.character);
			}).pipe(Effect.provide(platform), Effect.scoped),
	);
});
