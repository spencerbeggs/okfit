import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Effect, Exit, Option } from "effect";
import {
	editTarget,
	resolveActor,
	statusTextEdits,
	verifiedStableTextEdits,
	verifiedTextEdits,
} from "../../src/features/edits.js";
import { makeDocumentMemory } from "../../src/session/documents.js";
import type { SessionRegistryShape } from "../../src/session/registry.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { copyFixtureProject } from "../utils/fixture.js";
import { testPlatform, testPlatformWithGitDefect, testPlatformWithIdentity } from "../utils/platform.js";

/**
 * `features/edits.ts` wired against `makeSessionRegistry` and a bare
 * document memory directly, mirroring `hover.test.ts`'s lighter harness --
 * no transport, no scheduler.
 */

/** Builds a registry over a fresh fixture copy and loads its one folder's session. */
const setup = () =>
	Effect.gen(function* () {
		const { root } = yield* copyFixtureProject();
		const registry: SessionRegistryShape = yield* makeSessionRegistry({
			delay: "10 millis",
			maxWait: "10 seconds",
			onRevalidate: () => Effect.void,
			onDispose: () => Effect.void,
		});
		yield* registry.setFolders([root]);
		const path = `${root}/okf/modules/alpha.md`;
		// `editTarget` needs a loaded bundle to find the concept at `path`, so
		// revalidate directly -- mirrors `hover.test.ts`'s `openAndRevalidate`.
		const handle = Option.getOrThrow(yield* registry.sessionFor(path));
		const now = yield* DateTime.now;
		yield* handle.session.revalidate({ now, tier: "full" });
		const documents = yield* makeDocumentMemory();
		return { registry, path, handle, documents, disk: readFileSync(path, "utf8") };
	});

describe("resolveActor", () => {
	it.effect("a Git defect propagates rather than failing typed (regression: not swallowed by catchCause)", () =>
		Effect.gen(function* () {
			const { handle } = yield* setup();
			const exit = yield* Effect.exit(resolveActor(handle));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.isTrue(Cause.hasDies(exit.cause), `expected a died cause, got ${Cause.pretty(exit.cause)}`);
			}
		}).pipe(Effect.provide(testPlatformWithGitDefect())),
	);

	it.effect("no git identity configured fails typed with ActorUnresolved (positive control above)", () =>
		Effect.gen(function* () {
			const { handle } = yield* setup();
			const failure = yield* Effect.flip(resolveActor(handle));
			assert.strictEqual(failure._tag, "ActorUnresolved");
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("a resolved git identity resolves to the actor (positive control above)", () =>
		Effect.gen(function* () {
			const { handle } = yield* setup();
			assert.strictEqual(yield* resolveActor(handle), "human:fixture-author");
		}).pipe(Effect.provide(testPlatformWithIdentity())),
	);
});

describe("editTarget", () => {
	it.effect("a document that is not open targets the loaded text with version null", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			assert.strictEqual(target.text, disk);
			assert.isNull(target.version);
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect(
		"an open buffer that moved on since the last revalidate is the target: its text, version, status and verified actors",
		() =>
			Effect.gen(function* () {
				const { registry, documents, path, disk } = yield* setup();
				const edited = disk.replace(
					/^---\n/,
					'---\nstatus: deprecated\nverified:\n  - by: "human:someone"\n    at: "2026-01-01T00:00:00Z"\n',
				);
				assert.notStrictEqual(edited, disk);
				yield* documents.record(path, edited, 7);
				const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
				assert.strictEqual(target.text, edited);
				assert.strictEqual(target.version, 7);
				assert.strictEqual(target.status, "deprecated");
				assert.deepStrictEqual(target.verifiedBy, ["human:someone"]);
				// The splice is computed against the buffer, so it replaces the buffer's own `status:` value.
				const [edit] = yield* statusTextEdits(target, "draft");
				assert.deepStrictEqual(edit?.range, {
					start: { line: 1, character: 8 },
					end: { line: 1, character: 18 },
				});
			}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("an open buffer whose frontmatter no longer parses has no target", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			yield* documents.record(path, disk.replace(/^---\n/, "---\n[unclosed\n"), 3);
			assert.isTrue(Option.isNone(yield* editTarget(registry, documents, path)));
		}).pipe(Effect.provide(testPlatform())),
	);
});

describe("verifiedStableTextEdits", () => {
	const draftBuffer = (disk: string, extra = ""): string => disk.replace(/^---\n/, `---\nstatus: draft\n${extra}`);

	it.effect("on a draft: one set of edits, status stable and the verified entry", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			yield* documents.record(path, draftBuffer(disk), 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const now = yield* DateTime.now;
			const edits = yield* verifiedStableTextEdits(target, "human:fixture-author", now);
			assert.isAbove(edits.length, 0);
			assert.isTrue(edits.some((edit) => edit.newText.includes("status: stable") || edit.newText === "stable"));
			assert.isTrue(edits.some((edit) => edit.newText.includes("verified:")));
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("fails NotADraft on a concept that is not a draft", () =>
		Effect.gen(function* () {
			const { registry, documents, path } = yield* setup();
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const now = yield* DateTime.now;
			const failure = yield* Effect.flip(verifiedStableTextEdits(target, "human:fixture-author", now));
			assert.deepStrictEqual(failure, { _tag: "NotADraft" });
			const plain = yield* Effect.flip(verifiedTextEdits({ ...target, status: "draft" }, "human:fixture-author", now));
			assert.deepStrictEqual(plain, { _tag: "DraftCannotBeVerified" });
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("fails AlreadyVerified when the actor already carries a verified entry", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			yield* documents.record(
				path,
				draftBuffer(disk, 'verified:\n  - by: "human:fixture-author"\n    at: "2026-01-01T00:00:00Z"\n'),
				2,
			);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const now = yield* DateTime.now;
			const failure = yield* Effect.flip(verifiedStableTextEdits(target, "human:fixture-author", now));
			assert.deepStrictEqual(failure, { _tag: "AlreadyVerified", by: "human:fixture-author" });
		}).pipe(Effect.provide(testPlatform())),
	);
});
