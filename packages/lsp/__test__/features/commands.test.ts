import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { ApplyWorkspaceEditParams, ApplyWorkspaceEditResult } from "../../src/protocol/types.js";
import type { ServeHarness } from "../utils/harness.js";
import { makeServeHarness, request } from "../utils/harness.js";
import { testPlatform, testPlatformWithIdentity } from "../utils/platform.js";
import { applyTextEdit, singleDocumentEdit } from "../utils/textEdits.js";

/**
 * `registerCommands`, task 4 of the LSP-actions plan. Against a full
 * `serve()` harness (`makeServeHarness`), same posture as
 * `actions.test.ts`: `it.live`, the harness's scheduler runs on real elapsed
 * time, not the virtual clock.
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

Used only by \`registerCommands\`'s own tests.
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

const executeCommand = <R>(client: Parameters<typeof request>[0], command: string, args: ReadonlyArray<unknown>) =>
	request<R>(client, "workspace/executeCommand", { command, arguments: args });

/** `client.sendRequest`, but resolved as a JSON-RPC failure `{ code, message }` rather than throwing. */
const executeCommandFailure = (client: Parameters<typeof request>[0], command: string, args: ReadonlyArray<unknown>) =>
	Effect.tryPromise({
		try: () => client.sendRequest("workspace/executeCommand", { command, arguments: args }),
		catch: (error) => error as { readonly code: number; readonly message: string },
	}).pipe(Effect.flip);

/** The `WorkspaceEdit` of the `index`th `workspace/applyEdit` the harness's client received. */
const appliedEdit = (h: ServeHarness, index: number): ApplyWorkspaceEditParams["edit"] => {
	const received = h.serverRequests[index];
	if (received === undefined) throw new Error(`no server request #${index}`);
	return (received.params as ApplyWorkspaceEditParams).edit;
};

describe("registerCommands", () => {
	it.live(
		"okfit.lsp.setStatus sends one workspace/applyEdit that sets the concept's status, and answers the client's result",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness({ platform: noIdentityPlatform });
				yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
				yield* h.initialize;
				yield* h.open("okf/modules/stable.md");
				yield* h.nextPublish();

				const uri = h.uriOf("okf/modules/stable.md");
				const result = yield* executeCommand<ApplyWorkspaceEditResult>(h.client, "okfit.lsp.setStatus", [
					uri,
					"deprecated",
				]);

				assert.deepStrictEqual(result, { applied: true });
				assert.strictEqual(h.serverRequests.length, 1);
				const [applyEdit1] = h.serverRequests;
				assert.strictEqual(applyEdit1?.method, "workspace/applyEdit");
				const params = applyEdit1?.params as ApplyWorkspaceEditParams;
				const change = singleDocumentEdit(params.edit, uri);
				assert.strictEqual(change.version, 1);
				assert.strictEqual(
					applyTextEdit(STABLE_SOURCE, change.edit),
					STABLE_SOURCE.replace("title: Stable Concept\n", "title: Stable Concept\nstatus: deprecated\n"),
				);
			}).pipe(Effect.scoped),
	);

	it.live("okfit.lsp.setStatus carries the client's applyEdit failure verbatim, no error", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
			h.onServerRequest("workspace/applyEdit", () => ({ applied: false, failureReason: "nope" }));
			yield* h.initialize;
			yield* h.open("okf/modules/stable.md");
			yield* h.nextPublish();

			const uri = h.uriOf("okf/modules/stable.md");
			const result = yield* executeCommand<ApplyWorkspaceEditResult>(h.client, "okfit.lsp.setStatus", [
				uri,
				"deprecated",
			]);

			assert.deepStrictEqual(result, { applied: false, failureReason: "nope" });
		}).pipe(Effect.scoped),
	);

	it.live("okfit.lsp.markVerified on a draft fails with a message naming it a draft", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: identityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "draft.md"), DRAFT_SOURCE, "utf8"));
			yield* h.initialize;
			yield* h.open("okf/modules/draft.md");
			yield* h.nextPublish();

			const uri = h.uriOf("okf/modules/draft.md");
			const failure = yield* executeCommandFailure(h.client, "okfit.lsp.markVerified", [uri]);

			assert.include(failure.message, "draft");
		}).pipe(Effect.scoped),
	);

	it.live(
		"okfit.lsp.markVerified on a stable concept with a resolved identity sends one applyEdit carrying the actor (positive control)",
		() =>
			Effect.gen(function* () {
				const h = yield* makeServeHarness({ platform: identityPlatform });
				yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
				yield* h.initialize;
				yield* h.open("okf/modules/stable.md");
				yield* h.nextPublish();

				const uri = h.uriOf("okf/modules/stable.md");
				const result = yield* executeCommand<ApplyWorkspaceEditResult>(h.client, "okfit.lsp.markVerified", [uri]);

				assert.deepStrictEqual(result, { applied: true });
				assert.strictEqual(h.serverRequests.length, 1);
				const [applyEdit1] = h.serverRequests;
				const params = applyEdit1?.params as ApplyWorkspaceEditParams;
				const change = singleDocumentEdit(params.edit, uri);
				assert.strictEqual(change.version, 1);
				assert.include(applyTextEdit(STABLE_SOURCE, change.edit), "human:");
			}).pipe(Effect.scoped),
	);

	it.live(
		"a buffer changed within the debounce window: setStatus then markVerified compute against the new text and carry its version, and a second markVerified sees the first",
		() =>
			Effect.gen(function* () {
				// A debounce far longer than the test: no change below is revalidated, so the session's snapshot
				// still holds the opened text throughout while the buffer moves on.
				const h = yield* makeServeHarness({ platform: identityPlatform, delay: "400 millis" });
				yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
				yield* h.initialize;
				yield* h.open("okf/modules/stable.md");
				yield* h.nextPublish();
				const uri = h.uriOf("okf/modules/stable.md");

				yield* executeCommand<ApplyWorkspaceEditResult>(h.client, "okfit.lsp.setStatus", [uri, "deprecated"]);
				const statusChange = singleDocumentEdit(appliedEdit(h, 0), uri);
				// The client applies the edit: the buffer gains a line above where `verified` goes.
				const afterStatus = applyTextEdit(STABLE_SOURCE, statusChange.edit);
				yield* h.change("okf/modules/stable.md", afterStatus, 2);
				yield* Effect.sleep("50 millis");

				yield* executeCommand<ApplyWorkspaceEditResult>(h.client, "okfit.lsp.markVerified", [uri]);
				const verifyChange = singleDocumentEdit(appliedEdit(h, 1), uri);
				assert.strictEqual(verifyChange.version, 2);
				const afterVerify = applyTextEdit(afterStatus, verifyChange.edit);
				assert.match(
					afterVerify,
					/\nstatus: deprecated\n[\s\S]*\nverified:\n {2}- by: human:fixture-author\n {4}at: \S+\n---\n/,
				);
				yield* h.change("okf/modules/stable.md", afterVerify, 3);
				yield* Effect.sleep("50 millis");

				const failure = yield* executeCommandFailure(h.client, "okfit.lsp.markVerified", [uri]);
				assert.strictEqual(failure.message, "already verified by human:fixture-author");
				assert.strictEqual(h.serverRequests.length, 2);
			}).pipe(Effect.scoped),
	);

	it.live('okfit.lsp.setStatus [uri, "bogus"] fails with the argument message', () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
			yield* h.initialize;
			yield* h.open("okf/modules/stable.md");
			yield* h.nextPublish();

			const uri = h.uriOf("okf/modules/stable.md");
			const failure = yield* executeCommandFailure(h.client, "okfit.lsp.setStatus", [uri, "bogus"]);

			assert.strictEqual(failure.message, "okfit.lsp.setStatus expects [uri, status]");
		}).pipe(Effect.scoped),
	);

	it.live("an unknown command fails", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			yield* h.initialize;

			const failure = yield* executeCommandFailure(h.client, "okfit.doesNotExist", []);

			assert.include(failure.message, "okfit.doesNotExist");
		}).pipe(Effect.scoped),
	);

	it.live("okfit.lsp.revalidate [] revalidates every live session and lists its root URI", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
			yield* h.initialize;
			yield* h.open("okf/modules/stable.md");
			// Drain `didOpen`'s own publish + bundleChanged first (the positive control that
			// a session already exists), so the assertions below are `okfit.lsp.revalidate`'s own.
			yield* h.nextPublish();
			yield* h.nextNotification((notification) => notification.method === "okfit/bundleChanged");

			const result = yield* executeCommand<{ readonly roots: ReadonlyArray<string> }>(
				h.client,
				"okfit.lsp.revalidate",
				[],
			);

			assert.deepStrictEqual(result.roots, [h.uriOf("okf")]);
			// The diagnostic set is unchanged, so no second publish fires (Publishing
			// rules: only a changed set republishes) -- but `okfit/bundleChanged` fires
			// for every completed revalidate regardless.
			yield* h.nextNotification((notification) => notification.method === "okfit/bundleChanged");
		}).pipe(Effect.scoped),
	);

	it.live("okfit.lsp.revalidate [otherRootUri] for an unknown root answers `{ roots: [] }`", () =>
		Effect.gen(function* () {
			const h = yield* makeServeHarness({ platform: noIdentityPlatform });
			yield* Effect.promise(() => writeFile(join(h.root, "okf", "modules", "stable.md"), STABLE_SOURCE, "utf8"));
			yield* h.initialize;
			yield* h.open("okf/modules/stable.md");
			yield* h.nextPublish();

			const result = yield* executeCommand<{ readonly roots: ReadonlyArray<string> }>(
				h.client,
				"okfit.lsp.revalidate",
				["file:///not/a/known/root"],
			);

			assert.deepStrictEqual(result.roots, []);
		}).pipe(Effect.scoped),
	);
});
