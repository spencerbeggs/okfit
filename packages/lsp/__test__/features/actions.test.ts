import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { CodeAction, CodeActionParams, LspDiagnostic, Range } from "../../src/protocol/types.js";
import type { ServeHarness } from "../utils/harness.js";
import { makeServeHarness, request } from "../utils/harness.js";
import { testPlatform, testPlatformCountingIdentity, testPlatformWithIdentity } from "../utils/platform.js";
import { applyTextEdit, singleDocumentEdit } from "../utils/textEdits.js";

/**
 * `registerCodeActions`, task 3 of the LSP-actions plan. Against a full
 * `serve()` harness (`makeServeHarness`) rather than a fake transport: the
 * `status-missing` case needs a real `RenderedDiagnostic` off a real publish,
 * not a hand-built stand-in. `it.live`, matching `server.test.ts`'s own
 * classification -- the harness's scheduler runs on real elapsed time, not
 * the virtual clock.
 */

const identityPlatform = testPlatformWithIdentity();
const noIdentityPlatform = testPlatform();

/** `"human:fixture-author"`, `testPlatformWithIdentity`'s resolved actor (email local part). */
const FIXTURE_ACTOR = "human:fixture-author";

const GENERATED = `generated:\n  by: "${FIXTURE_ACTOR}"\n  at: "2026-01-01T00:00:00Z"`;

const STABLE_SOURCE = `---
type: Module
title: Stable Concept
description: A concept with no status field, defaulting to stable.
${GENERATED}
---

# Stable Concept

Used only by \`registerCodeActions\`'s own tests.
`;

const DRAFT_SOURCE = `---
type: Module
title: Draft Concept
description: A draft concept.
status: draft
${GENERATED}
---

# Draft Concept
`;

const ALREADY_VERIFIED_SOURCE = `---
type: Module
title: Verified Concept
description: Already verified by the fixture actor.
status: stable
verified:
  - by: "${FIXTURE_ACTOR}"
    at: "2026-01-01T00:00:00Z"
${GENERATED}
---

# Verified Concept
`;

/** A top-level flow mapping: `locateTopLevelScalar` reports `"flow-mapping"`, so no status edit exists. */
const FLOW_SOURCE = `---
{type: Module, title: Flow Concept, description: "Flow-mapping frontmatter.", generated: {by: "${FIXTURE_ACTOR}", at: "2026-01-01T00:00:00Z"}}
---

# Flow Concept
`;

/** A leading BOM, so every offset `FrontmatterEdits` returns must be a whole-file offset into the BOM'd source. */
const BOM_SOURCE = `﻿---
type: Module
title: Bom Concept
description: A concept whose on-disk bytes open with a UTF-8 BOM.
${GENERATED}
---

# Bom Concept
`;

/** Line 0, character 0: inside every fixture's frontmatter (the opening fence). */
const FRONTMATTER: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

/** A position inside every fixture's body, well past the closing fence. */
const BODY: Range = { start: { line: 9, character: 0 }, end: { line: 9, character: 0 } };

const requestCodeAction = (
	client: Parameters<typeof request>[0],
	uri: string,
	options: {
		readonly range?: Range;
		readonly diagnostics?: ReadonlyArray<LspDiagnostic>;
		readonly only?: ReadonlyArray<string>;
	} = {},
) =>
	request<ReadonlyArray<CodeAction>>(client, "textDocument/codeAction", {
		textDocument: { uri },
		range: options.range ?? FRONTMATTER,
		context: {
			diagnostics: [...(options.diagnostics ?? [])],
			...(options.only === undefined ? {} : { only: [...options.only] }),
		},
	} satisfies CodeActionParams);

const titleOf = (action: CodeAction): string => action.title;

/** `action`'s one versioned document change for `uri`. */
const changeOf = (action: CodeAction, uri: string) => singleDocumentEdit(action.edit, uri);

/** `[title, kind, isPreferred]` per action, in order: the whole observable action set at a glance. */
const shapeOf = (actions: ReadonlyArray<CodeAction>) =>
	actions.map((action) => [action.title, action.kind, action.isPreferred === true] as const);

/** Opens `relative` (written with `source` first) and waits for its first publish. */
const openConcept = (h: ServeHarness, relative: string, source: string) =>
	Effect.gen(function* () {
		yield* Effect.promise(() => writeFile(join(h.root, relative), source, "utf8"));
		yield* h.initialize;
		yield* h.open(relative);
		yield* h.nextPublish();
		return h.uriOf(relative);
	});

describe("registerCodeActions", () => {
	it.live(
		"a concept with no explicit status offers all three statuses and `Mark verified by <actor>`, each a versioned edit (positive control for the verify action)",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness({ platform: identityPlatform });
				const uri = yield* openConcept(h, "okf/modules/stable.md", STABLE_SOURCE);
				const actions = yield* requestCodeAction(h.client, uri);

				assert.deepStrictEqual(shapeOf(actions), [
					["Set status: draft", "okfit.status", false],
					["Set status: stable", "okfit.status", false],
					["Set status: deprecated", "okfit.status", false],
					["Mark verified by human:fixture-author", "okfit.verify", false],
				]);
				for (const action of actions) assert.strictEqual(changeOf(action, uri).version, 1);

				const stable = changeOf(actions[1] as CodeAction, uri);
				assert.strictEqual(
					applyTextEdit(STABLE_SOURCE, stable.edit),
					STABLE_SOURCE.replace("title: Stable Concept\n", "title: Stable Concept\nstatus: stable\n"),
				);
				const verify = changeOf(actions[3] as CodeAction, uri);
				assert.include(applyTextEdit(STABLE_SOURCE, verify.edit), FIXTURE_ACTOR);
			}).pipe(Effect.scoped),
	);

	it.live("git identity absent: the three status actions, no `Mark verified` (the default case)", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			const uri = yield* openConcept(h, "okf/modules/stable.md", STABLE_SOURCE);
			const actions = yield* requestCodeAction(h.client, uri);
			assert.deepStrictEqual(actions.map(titleOf), [
				"Set status: draft",
				"Set status: stable",
				"Set status: deprecated",
			]);
		}).pipe(Effect.scoped),
	);

	it.live("a draft concept offers `stable`/`deprecated`, never `Mark verified`", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: identityPlatform });
			const uri = yield* openConcept(h, "okf/modules/draft.md", DRAFT_SOURCE);
			const actions = yield* requestCodeAction(h.client, uri);
			assert.deepStrictEqual(actions.map(titleOf), ["Set status: stable", "Set status: deprecated"]);
		}).pipe(Effect.scoped),
	);

	it.live("a concept already verified by the resolved actor offers no `Mark verified` action", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: identityPlatform });
			const uri = yield* openConcept(h, "okf/modules/verified.md", ALREADY_VERIFIED_SOURCE);
			const actions = yield* requestCodeAction(h.client, uri);
			assert.deepStrictEqual(actions.map(titleOf), ["Set status: draft", "Set status: deprecated"]);
		}).pipe(Effect.scoped),
	);

	it.live(
		"a `status-missing` diagnostic: quick fixes `draft` (preferred) and `stable` anywhere, plus `deprecated` as a status action in the frontmatter",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness({ platform: noIdentityPlatform });
				yield* Effect.promise(() =>
					writeFile(
						join(h.root, ".okfit.toml"),
						'[lint]\ngenerated_at_drift = "off"\nstatus_missing = "warn"\n',
						"utf8",
					),
				);
				yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
				yield* h.initialize;
				yield* h.open("okf/modules/stable.md");
				const published = yield* h.drainUntil((entry) => entry.uri === h.uriOf("okf/modules/stable.md"));
				const statusMissing = published.diagnostics.find((entry) => entry.code === "status-missing");
				assert.isDefined(statusMissing);
				assert.strictEqual(
					(statusMissing as { readonly data?: { readonly source?: string } }).data?.source,
					"core.lint",
				);
				const diagnostics = [statusMissing as unknown as LspDiagnostic];
				const uri = h.uriOf("okf/modules/stable.md");

				const inFrontmatter = yield* requestCodeAction(h.client, uri, { diagnostics });
				assert.deepStrictEqual(shapeOf(inFrontmatter), [
					["Set status: draft", "quickfix", true],
					["Set status: stable", "quickfix", false],
					["Set status: deprecated", "okfit.status", false],
				]);
				for (const action of inFrontmatter.slice(0, 2)) assert.deepStrictEqual(action.diagnostics, diagnostics);

				const inBody = yield* requestCodeAction(h.client, uri, { diagnostics, range: BODY });
				assert.deepStrictEqual(shapeOf(inBody), [
					["Set status: draft", "quickfix", true],
					["Set status: stable", "quickfix", false],
				]);
			}).pipe(Effect.scoped),
	);

	it.live(
		"a body-range request with no diagnostics answers `[]`; `context.only` naming a kind offers it anywhere (frontmatter-range positive control above)",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness({ platform: identityPlatform });
				const uri = yield* openConcept(h, "okf/modules/stable.md", STABLE_SOURCE);

				assert.deepStrictEqual(yield* requestCodeAction(h.client, uri, { range: BODY }), []);
				assert.deepStrictEqual(
					(yield* requestCodeAction(h.client, uri, { range: BODY, only: ["okfit.verify"] })).map(titleOf),
					["Mark verified by human:fixture-author"],
				);
				assert.deepStrictEqual(
					(yield* requestCodeAction(h.client, uri, { range: BODY, only: ["okfit"] })).map(titleOf),
					[
						"Set status: draft",
						"Set status: stable",
						"Set status: deprecated",
						"Mark verified by human:fixture-author",
					],
				);
				assert.deepStrictEqual(yield* requestCodeAction(h.client, uri, { only: ["quickfix"] }), []);
			}).pipe(Effect.scoped),
	);

	it.live(
		"the human actor is resolved once for the first frontmatter request, cached after, and never for a body request",
		() =>
			Effect.gen(function* () {
				const counter = { email: 0 };
				const h = yield* makeServeHarness({ platform: testPlatformCountingIdentity(counter) });
				const uri = yield* openConcept(h, "okf/modules/stable.md", STABLE_SOURCE);
				const before = counter.email;

				yield* requestCodeAction(h.client, uri, { range: BODY });
				assert.strictEqual(counter.email - before, 0);
				const first = yield* requestCodeAction(h.client, uri);
				assert.isTrue(first.some((action) => action.kind === "okfit.verify"));
				assert.strictEqual(counter.email - before, 1);
				yield* requestCodeAction(h.client, uri);
				assert.strictEqual(counter.email - before, 1);
			}).pipe(Effect.scoped),
	);

	it.live(
		"a buffer changed within the debounce window: edits are computed against the new text and carry its version",
		() =>
			Effect.gen(function* () {
				// A debounce far longer than the test: the change below is never revalidated, so the session's
				// snapshot still holds the opened text while the buffer has moved on.
				const h = yield* makeServeHarness({ platform: identityPlatform, delay: "400 millis" });
				const uri = yield* openConcept(h, "okf/modules/stable.md", STABLE_SOURCE);

				// One new line above `title:` (shifting the status insert down a line) and a `verified` entry
				// by the resolved actor (which the stale snapshot does not have).
				const changed = STABLE_SOURCE.replace(
					"type: Module\n",
					`type: Module\nresource: stable.md\nverified:\n  - by: "${FIXTURE_ACTOR}"\n    at: "2026-01-01T00:00:00Z"\n`,
				);
				yield* h.change("okf/modules/stable.md", changed, 2);
				yield* Effect.sleep("50 millis");

				const actions = yield* requestCodeAction(h.client, uri);
				assert.deepStrictEqual(actions.map(titleOf), [
					"Set status: draft",
					"Set status: stable",
					"Set status: deprecated",
				]);
				const draft = changeOf(actions[0] as CodeAction, uri);
				assert.strictEqual(draft.version, 2);
				assert.strictEqual(
					applyTextEdit(changed, draft.edit),
					changed.replace("title: Stable Concept\n", "title: Stable Concept\nstatus: draft\n"),
				);
			}).pipe(Effect.scoped),
	);

	it.live("a non-concept file under the folder answers `[]` (positive control above)", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "notes.txt"), "not a concept\n", "utf8"));
			yield* h.initialize;
			yield* h.open("okf/modules/notes.txt");

			const uri = h.uriOf("okf/modules/notes.txt");
			const actions = yield* requestCodeAction(h.client, uri);
			assert.deepStrictEqual(actions, []);
		}).pipe(Effect.scoped),
	);

	it.live(
		"a flow-mapping frontmatter concept: status actions absent, no error (`Mark verified` is a separate locator -- positive control above)",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness({ platform: noIdentityPlatform });
				const uri = yield* openConcept(h, "okf/modules/flow.md", FLOW_SOURCE);
				const actions = yield* requestCodeAction(h.client, uri);
				assert.deepStrictEqual(
					actions.filter((action) => action.title.startsWith("Set status:")),
					[],
				);
			}).pipe(Effect.scoped),
	);

	it.live(
		"a leading BOM: core never decodes the file as a concept at all (`frontmatter-missing`), so no offset ever needs BOM adjustment -- same as a non-concept file (positive control above)",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness({ platform: noIdentityPlatform });
				yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "bom.md"), BOM_SOURCE, "utf8"));
				yield* h.initialize;
				yield* h.open("okf/modules/bom.md");
				const published = yield* h.nextPublish();
				assert.isTrue(published.diagnostics.some((entry) => entry.code === "frontmatter-missing"));

				const uri = h.uriOf("okf/modules/bom.md");
				const actions = yield* requestCodeAction(h.client, uri);
				assert.deepStrictEqual(actions, []);
			}).pipe(Effect.scoped),
	);
});
