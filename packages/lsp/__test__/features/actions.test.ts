import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { CodeAction, CodeActionParams, LspDiagnostic } from "../../src/protocol/types.js";
import { makeServeHarness, request } from "../utils/harness.js";
import { testPlatform, testPlatformWithIdentity } from "../utils/platform.js";

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

/** Applies one `TextEdit` (as `toLspRange` computed it) to `text`, converting line/character back to an offset the same way `offsetOf` does. */
const applyEdit = (
	text: string,
	edit: { readonly range: { readonly start: Position; readonly end: Position }; readonly newText: string },
): string => {
	const toOffset = (position: Position): number => {
		let offset = 0;
		let line = 0;
		while (line < position.line && offset < text.length) {
			const code = text.charCodeAt(offset);
			if (code === 0x0d) {
				offset++;
				if (text.charCodeAt(offset) === 0x0a) offset++;
				line++;
			} else if (code === 0x0a) {
				offset++;
				line++;
			} else {
				offset++;
			}
		}
		const lineStart = offset;
		while (offset < text.length && offset - lineStart < position.character) {
			const code = text.charCodeAt(offset);
			if (code === 0x0d || code === 0x0a) break;
			offset++;
		}
		return offset;
	};
	const start = toOffset(edit.range.start);
	const end = toOffset(edit.range.end);
	return text.slice(0, start) + edit.newText + text.slice(end);
};

interface Position {
	readonly line: number;
	readonly character: number;
}

const requestCodeAction = (
	client: Parameters<typeof request>[0],
	uri: string,
	diagnostics: ReadonlyArray<LspDiagnostic> = [],
) =>
	request<ReadonlyArray<CodeAction>>(client, "textDocument/codeAction", {
		textDocument: { uri },
		range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
		context: { diagnostics: [...diagnostics] },
	} satisfies CodeActionParams);

const titleOf = (action: CodeAction): string => action.title;
const changeOf = (action: CodeAction, uri: string) => {
	const edits = action.edit?.changes?.[uri];
	if (edits === undefined || edits.length !== 1) throw new Error(`expected exactly one TextEdit on ${action.title}`);
	return edits[0];
};

describe("registerCodeActions", () => {
	it.live(
		"a stable concept offers `Set status: draft`/`Set status: deprecated` and `Mark verified by <actor>`, never `Set status: stable` (positive control for the verify action)",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness({ platform: identityPlatform });
				yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
				yield* h.initialize;
				yield* h.open("okf/modules/stable.md");
				yield* h.nextPublish();

				const uri = h.uriOf("okf/modules/stable.md");
				const actions = yield* requestCodeAction(h.client, uri);

				assert.deepStrictEqual(
					actions.map(titleOf).sort(),
					["Mark verified by human:fixture-author", "Set status: deprecated", "Set status: draft"].sort(),
				);
				assert.isFalse(actions.some((action) => action.title === "Set status: stable"));

				const draft = actions.find((action) => action.title === "Set status: draft");
				assert.isDefined(draft);
				assert.strictEqual(draft?.kind, "okfit.status");
				const draftEdit = changeOf(draft as CodeAction, uri);
				assert.include(applyEdit(STABLE_SOURCE, draftEdit), "status: draft");

				const deprecated = actions.find((action) => action.title === "Set status: deprecated");
				assert.strictEqual(deprecated?.kind, "okfit.status");
				const deprecatedEdit = changeOf(deprecated as CodeAction, uri);
				assert.include(applyEdit(STABLE_SOURCE, deprecatedEdit), "status: deprecated");

				const verify = actions.find((action) => action.title.startsWith("Mark verified by"));
				assert.strictEqual(verify?.kind, "okfit.verify");
				const verifyEdit = changeOf(verify as CodeAction, uri);
				assert.include(applyEdit(STABLE_SOURCE, verifyEdit), FIXTURE_ACTOR);
			}).pipe(Effect.scoped),
	);

	it.live("git identity absent: status actions present, `Mark verified` absent (the default case)", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
			yield* h.initialize;
			yield* h.open("okf/modules/stable.md");
			yield* h.nextPublish();

			const uri = h.uriOf("okf/modules/stable.md");
			const actions = yield* requestCodeAction(h.client, uri);

			assert.deepStrictEqual(actions.map(titleOf).sort(), ["Set status: deprecated", "Set status: draft"].sort());
		}).pipe(Effect.scoped),
	);

	it.live("a draft concept offers `stable`/`deprecated`, never `Mark verified`", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: identityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "draft.md"), DRAFT_SOURCE, "utf8"));
			yield* h.initialize;
			yield* h.open("okf/modules/draft.md");
			yield* h.nextPublish();

			const uri = h.uriOf("okf/modules/draft.md");
			const actions = yield* requestCodeAction(h.client, uri);

			assert.deepStrictEqual(actions.map(titleOf).sort(), ["Set status: deprecated", "Set status: stable"].sort());
		}).pipe(Effect.scoped),
	);

	it.live("a concept already verified by the resolved actor offers no `Mark verified` action", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: identityPlatform });
			yield* Effect.promise(() =>
				writeFile(join(h.root, "okf", "modules", "verified.md"), ALREADY_VERIFIED_SOURCE, "utf8"),
			);
			yield* h.initialize;
			yield* h.open("okf/modules/verified.md");
			yield* h.nextPublish();

			const uri = h.uriOf("okf/modules/verified.md");
			const actions = yield* requestCodeAction(h.client, uri);

			assert.isFalse(actions.some((action) => action.title.startsWith("Mark verified")));
			assert.deepStrictEqual(actions.map(titleOf).sort(), ["Set status: deprecated", "Set status: draft"].sort());
		}).pipe(Effect.scoped),
	);

	it.live(
		"a `status-missing` diagnostic in context promotes the status actions to `quickfix`, attaches the diagnostic, and prefers `draft` (positive control above proves `okfit.status` is the default kind)",
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

				const uri = h.uriOf("okf/modules/stable.md");
				const actions = yield* requestCodeAction(h.client, uri, [statusMissing as unknown as LspDiagnostic]);

				const statusActions = actions.filter((action) => action.title.startsWith("Set status:"));
				assert.strictEqual(statusActions.length, 2);
				for (const action of statusActions) {
					assert.strictEqual(action.kind, "quickfix");
					assert.deepStrictEqual(action.diagnostics, [statusMissing as unknown as LspDiagnostic]);
					assert.strictEqual(action.isPreferred === true, action.title === "Set status: draft");
				}
			}).pipe(Effect.scoped),
	);

	it.live("a document edited after it was opened: the status edit's range still targets the live `status:` line", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
			yield* h.initialize;
			yield* h.open("okf/modules/stable.md");
			yield* h.nextPublish();

			const changed = STABLE_SOURCE.replace(
				"Used only by `registerCodeActions`'s own tests.",
				"Used only by `registerCodeActions`'s own tests.\n\nAn extra paragraph shifts every later offset.",
			);
			yield* h.change("okf/modules/stable.md", changed, 2);
			// The appended paragraph changes nothing diagnostically, so no second publish fires (only a
			// changed diagnostic set republishes); wait out the scheduler's debounce instead.
			yield* Effect.sleep("200 millis");

			const uri = h.uriOf("okf/modules/stable.md");
			const actions = yield* requestCodeAction(h.client, uri);
			const draft = actions.find((action) => action.title === "Set status: draft");
			assert.isDefined(draft);
			const edit = changeOf(draft as CodeAction, uri);
			assert.include(applyEdit(changed, edit), "status: draft");
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
				yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "flow.md"), FLOW_SOURCE, "utf8"));
				yield* h.initialize;
				yield* h.open("okf/modules/flow.md");
				yield* h.nextPublish();

				const uri = h.uriOf("okf/modules/flow.md");
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
