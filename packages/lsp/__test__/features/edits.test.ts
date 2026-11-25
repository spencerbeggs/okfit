import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Concept, Derive, Status } from "@okfit/core";
import { Cause, DateTime, Effect, Exit, Option, Schema } from "effect";
import {
	derivedStatusOf,
	describeFailure,
	editTarget,
	resolveActor,
	statusTextEdits,
	verifiedStableTextEdits,
	verifiedTextEdits,
} from "../../src/features/edits.js";
import { makeDocumentMemory } from "../../src/session/documents.js";
import type { SessionRegistryShape } from "../../src/session/registry.js";
import { makeSessionRegistry } from "../../src/session/registry.js";
import { withBinding } from "../utils/digest.js";
import { copyFixtureProject } from "../utils/fixture.js";
import { testPlatform, testPlatformWithGitDefect, testPlatformWithIdentity } from "../utils/platform.js";

/**
 * `features/edits.ts` wired against `makeSessionRegistry` and a bare
 * document memory directly, mirroring `hover.test.ts`'s lighter harness --
 * no transport, no scheduler.
 */

/** A fixed instant after the fixture's `generated.at` (the TestClock reads 1970, before it, so `DateTime.now` would not be current). */
const VERIFY_AT = DateTime.makeUnsafe("2026-06-01T00:00:00Z");

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
				assert.deepStrictEqual(
					target.verified.map((entry) => entry.by),
					["human:someone"],
				);
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
			const now = VERIFY_AT;
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
			const now = VERIFY_AT;
			const failure = yield* Effect.flip(verifiedStableTextEdits(target, "human:fixture-author", now));
			assert.deepStrictEqual(failure, { _tag: "NotADraft" });
			const plain = yield* Effect.flip(verifiedTextEdits({ ...target, status: "draft" }, "human:fixture-author", now));
			assert.deepStrictEqual(plain, { _tag: "DraftCannotBeVerified" });
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect(
		"offers a drifted verification again: an entry with no binding, or a stale one, is not AlreadyVerified",
		() =>
			Effect.gen(function* () {
				const { registry, documents, path, disk } = yield* setup();
				const entry = 'verified:\n  - by: "human:fixture-author"\n    at: "2026-01-01T00:00:00Z"\n';
				const now = VERIFY_AT;
				const bound = yield* withBinding(draftBuffer(disk, entry), "human:fixture-author", "2026-01-01T00:00:00Z");
				for (const buffer of [draftBuffer(disk, entry), bound.replace("Alpha", "Altered")]) {
					yield* documents.record(path, buffer, 2);
					const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
					const edits = yield* verifiedStableTextEdits(target, "human:fixture-author", now);
					assert.isTrue(edits.some((edit) => edit.newText.includes("content: ")));
				}
			}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("fails AlreadyVerified when the actor's verification still binds the current content", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const verified = draftBuffer(disk, 'verified:\n  - by: "human:fixture-author"\n    at: "2026-01-01T00:00:00Z"\n');
			yield* documents.record(path, yield* withBinding(verified, "human:fixture-author", "2026-01-01T00:00:00Z"), 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const now = VERIFY_AT;
			const failure = yield* Effect.flip(verifiedStableTextEdits(target, "human:fixture-author", now));
			assert.deepStrictEqual(failure, { _tag: "AlreadyVerified", by: "human:fixture-author" });
		}).pipe(Effect.provide(testPlatform())),
	);
});

describe("verifiedTextEdits: already-verified agrees with Trust", () => {
	const entry = (by: string, at: string): string => `verified:\n  - by: "${by}"\n    at: "${at}"\n`;

	it.effect("an unchanged current binding by the actor is AlreadyVerified", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const verified = disk.replace(/^---\n/, `---\n${entry("human:fixture-author", "2026-01-01T00:00:00Z")}`);
			yield* documents.record(path, yield* withBinding(verified, "human:fixture-author", "2026-01-01T00:00:00Z"), 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const now = VERIFY_AT;
			const failure = yield* Effect.flip(verifiedTextEdits(target, "human:fixture-author", now));
			assert.deepStrictEqual(failure, { _tag: "AlreadyVerified", by: "human:fixture-author" });
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("a later unbound human entry supersedes ada's binding, so ada is offered a re-verify", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const both = disk.replace(
				/^---\n/,
				`---\nverified:\n  - by: "human:ada"\n    at: "2026-01-01T00:00:00Z"\n  - by: "human:bob"\n    at: "2026-02-01T00:00:00Z"\n`,
			);
			yield* documents.record(path, yield* withBinding(both, "human:ada", "2026-01-01T00:00:00Z"), 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const now = VERIFY_AT;
			const edits = yield* verifiedTextEdits(target, "human:ada", now);
			assert.isTrue(edits.some((edit) => edit.newText.includes("content: ")));
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("a bare-mapping `verified` with a current binding by the actor is AlreadyVerified (OKF 5.2)", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const bare = disk.replace(/^---\n/, '---\nverified:\n  by: "human:ada"\n  at: "2026-01-01T00:00:00Z"\n');
			yield* documents.record(path, yield* withBinding(bare, "human:ada", "2026-01-01T00:00:00Z"), 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			assert.lengthOf(target.verified, 1);
			const now = VERIFY_AT;
			const failure = yield* Effect.flip(verifiedTextEdits(target, "human:ada", now));
			assert.deepStrictEqual(failure, { _tag: "AlreadyVerified", by: "human:ada" });
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("a list with one malformed entry is treated as no entries, as core does", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const bad = disk.replace(
				/^---\n/,
				'---\nverified:\n  - by: "human:ada"\n    at: "2026-01-01T00:00:00Z"\n  - by: "human:bob"\n    at: "not-a-time"\n',
			);
			yield* documents.record(path, bad, 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			assert.deepStrictEqual(target.verified, []);
		}).pipe(Effect.provide(testPlatform())),
	);
});

describe("derivedStatusOf agrees with Derive.status (OKF 0.3 5.4, 11.2 rule 1)", () => {
	const table: ReadonlyArray<readonly [string, unknown, "draft" | "stable" | "deprecated" | "unknown"]> = [
		["a vocabulary string", "deprecated", "deprecated"],
		["draft", "draft", "draft"],
		["another string", "archived", "unknown"],
		["a number", 5, "unknown"],
		["a boolean", true, "unknown"],
		["a list", ["draft"], "unknown"],
		["a mapping", { status: "draft" }, "unknown"],
		["null", null, "stable"],
		["the empty string", "", "stable"],
		["an empty list", [], "stable"],
		["absent", undefined, "stable"],
	];
	const conceptWith = (raw: unknown): Concept =>
		Concept.make({
			type: "Note",
			extensions: {},
			raw: { type: "Note", ...(raw === undefined ? {} : { status: raw }) },
			...(Schema.is(Status)(raw) ? { status: raw } : {}),
		});

	for (const [name, raw, expected] of table) {
		it(`${name}: the same answer as Derive.status`, () => {
			assert.strictEqual(Derive.status(conceptWith(raw)), expected);
			assert.strictEqual(derivedStatusOf(raw), expected);
		});
	}
});

describe("verification on a status outside the vocabulary", () => {
	const withStatus = (disk: string, line: string): string => disk.replace(/^---\n/, `---\n${line}\n`);

	it.effect("verifiedTextEdits fails UnknownStatusCannotBeVerified naming the raw text; stable succeeds", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const now = VERIFY_AT;
			for (const [line, raw] of [
				["status: archived", "archived"],
				["status: 5", "5"],
			] as const) {
				yield* documents.record(path, withStatus(disk, line), 2);
				const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
				const failure = yield* Effect.flip(verifiedTextEdits(target, "human:fixture-author", now));
				assert.deepStrictEqual(failure, { _tag: "UnknownStatusCannotBeVerified", status: raw });
			}
			yield* documents.record(path, withStatus(disk, "status: stable"), 3);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const edits = yield* verifiedTextEdits(target, "human:fixture-author", now);
			assert.isAbove(edits.length, 0);
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("an absent, null or empty status verifies as stable, never as unknown", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const now = VERIFY_AT;
			for (const line of ["status: null", 'status: ""', "status: []"]) {
				yield* documents.record(path, withStatus(disk, line), 2);
				const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
				assert.isAbove((yield* verifiedTextEdits(target, "human:fixture-author", now)).length, 0);
			}
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect(
		"verifiedStableTextEdits refuses every unknown status; a draft succeeds, stable and deprecated fail NotADraft",
		() =>
			Effect.gen(function* () {
				const { registry, documents, path, disk } = yield* setup();
				const now = VERIFY_AT;
				const attempt = (line: string) =>
					Effect.gen(function* () {
						yield* documents.record(path, withStatus(disk, line), 2);
						const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
						return yield* Effect.flip(verifiedStableTextEdits(target, "human:fixture-author", now));
					});
				for (const [line, raw] of [
					["status: archived", "archived"],
					["status: 5", "5"],
					["status: [a]", '["a"]'],
					["status: {a: 1}", '{"a":1}'],
				] as const) {
					assert.deepStrictEqual(yield* attempt(line), { _tag: "UnknownStatusCannotBeVerified", status: raw });
				}
				// controls: stable and deprecated keep failing NotADraft; a draft succeeds
				assert.deepStrictEqual(yield* attempt("status: stable"), { _tag: "NotADraft" });
				assert.deepStrictEqual(yield* attempt("status: deprecated"), { _tag: "NotADraft" });
				yield* documents.record(path, withStatus(disk, "status: draft"), 3);
				const draft = Option.getOrThrow(yield* editTarget(registry, documents, path));
				assert.isAbove((yield* verifiedStableTextEdits(draft, "human:fixture-author", now)).length, 0);
			}).pipe(Effect.provide(testPlatform())),
	);
});

describe("verified edits read `generated` (OKF 0.3 5.3, R33)", () => {
	const GEN = "2026-02-01T00:00:00Z";
	const withGeneratedAt = (disk: string, at: string): string =>
		disk.replace(/(generated:\n {2}by: .*\n {2}at: )".*"/, `$1"${at}"`);
	const entry = (by: string, at: string): string => `verified:\n  - by: "${by}"\n    at: "${at}"\n`;
	const before = DateTime.makeUnsafe("2026-01-31T23:59:59Z");
	const equal = DateTime.makeUnsafe(GEN);

	it.effect("EditTarget.generated is read from the buffer text; a malformed block is undefined", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			yield* documents.record(path, withGeneratedAt(disk, GEN), 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			assert.strictEqual(
				target.generated === undefined ? "" : DateTime.formatIso(target.generated.at),
				GEN.replace("Z", ".000Z"),
			);
			// malformed: `by` missing voids the whole block
			yield* documents.record(path, disk.replace(/generated:\n {2}by: .*\n/, "generated:\n"), 3);
			const malformed = Option.getOrThrow(yield* editTarget(registry, documents, path));
			assert.isUndefined(malformed.generated);
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("verifiedTextEdits fails NotCurrent when now is before generated.at; at generated.at it succeeds", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			yield* documents.record(path, withGeneratedAt(disk, GEN), 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const failure = yield* Effect.flip(verifiedTextEdits(target, "human:fixture-author", before));
			assert.deepStrictEqual(failure, { _tag: "NotCurrent", generatedAt: GEN });
			assert.strictEqual(describeFailure(failure).includes(GEN), true);
			const ok = yield* verifiedTextEdits(target, "human:fixture-author", equal);
			assert.isTrue(ok.some((edit) => edit.newText.includes(`at: ${GEN}`)));
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("verifiedStableTextEdits fails NotCurrent the same way; an absent generated.at succeeds", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const draft = withGeneratedAt(disk, GEN).replace(/^---\n/, "---\nstatus: draft\n");
			yield* documents.record(path, draft, 2);
			const target = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const failure = yield* Effect.flip(verifiedStableTextEdits(target, "human:fixture-author", before));
			assert.deepStrictEqual(failure, { _tag: "NotCurrent", generatedAt: GEN });
			const ok = yield* verifiedStableTextEdits(target, "human:fixture-author", equal);
			assert.isAbove(ok.length, 0);
			// control: no generated block at all accepts any now
			const bare = disk.replace(/generated:\n {2}by: .*\n {2}at: ".*"\n/, "").replace(/^---\n/, "---\nstatus: draft\n");
			yield* documents.record(path, bare, 3);
			const free = Option.getOrThrow(yield* editTarget(registry, documents, path));
			assert.isUndefined(free.generated);
			const anyTime = yield* verifiedStableTextEdits(
				free,
				"human:fixture-author",
				DateTime.makeUnsafe("1999-01-01T00:00:00Z"),
			);
			assert.isAbove(anyTime.length, 0);
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("a binding older than generated.at is not AlreadyVerified (Task 5 rule); one at generated.at is", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const now = DateTime.makeUnsafe("2026-03-01T00:00:00Z");
			const older = withGeneratedAt(disk, GEN).replace(/^---\n/, `---\n${entry("human:ada", "2026-01-15T00:00:00Z")}`);
			yield* documents.record(path, yield* withBinding(older, "human:ada", "2026-01-15T00:00:00Z"), 2);
			const staleTarget = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const edits = yield* verifiedTextEdits(staleTarget, "human:ada", now);
			assert.isTrue(edits.some((edit) => edit.newText.includes("content: ")));
			const equalText = withGeneratedAt(disk, GEN).replace(/^---\n/, `---\n${entry("human:ada", GEN)}`);
			yield* documents.record(path, yield* withBinding(equalText, "human:ada", GEN), 3);
			const currentTarget = Option.getOrThrow(yield* editTarget(registry, documents, path));
			const failure = yield* Effect.flip(verifiedTextEdits(currentTarget, "human:ada", now));
			assert.deepStrictEqual(failure, { _tag: "AlreadyVerified", by: "human:ada" });
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect("a legacy top-level `timestamp` reads as generated.at, as core folds it (D-15)", () =>
		Effect.gen(function* () {
			const { registry, documents, path, disk } = yield* setup();
			const LATER = "2026-06-02T00:00:00Z";
			const bare = disk.replace(/generated:\n {2}by: .*\n {2}at: ".*"\n/, "");
			const verified = (text: string) =>
				withBinding(
					text.replace(/^---\n/, `---\n${entry("human:ada", "2026-06-01T00:00:00Z")}`),
					"human:ada",
					"2026-06-01T00:00:00Z",
				);
			const legacy = yield* verified(bare.replace(/^---\n/, `---\ntimestamp: "${LATER}"\n`));
			const real = yield* verified(bare.replace(/^---\n/, `---\ngenerated:\n  by: human:ada\n  at: "${LATER}"\n`));
			const control = yield* verified(
				bare.replace(/^---\n/, '---\ngenerated:\n  by: human:ada\n  at: "2026-06-01T00:00:00Z"\n'),
			);
			const now = DateTime.makeUnsafe("2026-06-10T00:00:00Z");
			const early = DateTime.makeUnsafe("2026-06-01T12:00:00Z");
			const targetOf = (text: string, version: number) =>
				Effect.gen(function* () {
					yield* documents.record(path, text, version);
					return Option.getOrThrow(yield* editTarget(registry, documents, path));
				});
			const legacyTarget = yield* targetOf(legacy, 2);
			assert.strictEqual(
				legacyTarget.generated === undefined ? "" : DateTime.formatIso(legacyTarget.generated.at),
				LATER.replace("Z", ".000Z"),
			);
			// positive control: a verification at generated.at is AlreadyVerified
			const controlTarget = yield* targetOf(control, 3);
			assert.deepStrictEqual(yield* Effect.flip(verifiedTextEdits(controlTarget, "human:ada", now)), {
				_tag: "AlreadyVerified",
				by: "human:ada",
			});
			// the legacy timestamp is later than the binding: not AlreadyVerified, and a verify before it is NotCurrent
			assert.isAbove((yield* verifiedTextEdits(legacyTarget, "human:ada", now)).length, 0);
			assert.deepStrictEqual(yield* Effect.flip(verifiedTextEdits(legacyTarget, "human:ada", early)), {
				_tag: "NotCurrent",
				generatedAt: LATER,
			});
			// a real `generated` block wins over a legacy timestamp, as in core
			const both = yield* targetOf(control.replace(/^---\n/, `---\ntimestamp: "${LATER}"\n`), 4);
			assert.strictEqual(both.generated?.by, "human:ada");
			// control: the same outcomes with a real generated.at
			const realTarget = yield* targetOf(real, 5);
			assert.isAbove((yield* verifiedTextEdits(realTarget, "human:ada", now)).length, 0);
			assert.deepStrictEqual(yield* Effect.flip(verifiedTextEdits(realTarget, "human:ada", early)), {
				_tag: "NotCurrent",
				generatedAt: LATER,
			});
		}).pipe(Effect.provide(testPlatform())),
	);

	it.effect(
		"order: a status refusal wins over NotCurrent; a draft that is not current fails NotCurrent in the stable path",
		() =>
			Effect.gen(function* () {
				const { registry, documents, path, disk } = yield* setup();
				const future = withGeneratedAt(disk, GEN);
				const actor = "human:fixture-author";
				// unknown status AND not current: the status refusal comes first, in both entry points
				yield* documents.record(path, future.replace(/^---\n/, "---\nstatus: bogus\n"), 2);
				const unknown = Option.getOrThrow(yield* editTarget(registry, documents, path));
				assert.deepStrictEqual(yield* Effect.flip(verifiedTextEdits(unknown, actor, before)), {
					_tag: "UnknownStatusCannotBeVerified",
					status: "bogus",
				});
				assert.deepStrictEqual(yield* Effect.flip(verifiedStableTextEdits(unknown, actor, before)), {
					_tag: "UnknownStatusCannotBeVerified",
					status: "bogus",
				});
				// draft AND not current: verifiedTextEdits refuses the draft first; the stable path reaches NotCurrent
				yield* documents.record(path, future.replace(/^---\n/, "---\nstatus: draft\n"), 3);
				const draft = Option.getOrThrow(yield* editTarget(registry, documents, path));
				assert.deepStrictEqual(yield* Effect.flip(verifiedTextEdits(draft, actor, before)), {
					_tag: "DraftCannotBeVerified",
				});
				assert.deepStrictEqual(yield* Effect.flip(verifiedStableTextEdits(draft, actor, before)), {
					_tag: "NotCurrent",
					generatedAt: GEN,
				});
				// not a draft AND not current in the stable path: NotADraft comes first
				const plain = Option.getOrThrow(
					yield* documents.record(path, future, 4).pipe(Effect.flatMap(() => editTarget(registry, documents, path))),
				);
				assert.deepStrictEqual(yield* Effect.flip(verifiedStableTextEdits(plain, actor, before)), {
					_tag: "NotADraft",
				});
				// control: the plain concept at generated.at verifies
				assert.isAbove((yield* verifiedTextEdits(plain, actor, equal)).length, 0);
			}).pipe(Effect.provide(testPlatform())),
	);
});

describe("describeFailure for NotCurrent (#470)", () => {
	it("describeFailure names okfit sync for NotCurrent", () => {
		assert.strictEqual(
			describeFailure({ _tag: "NotCurrent", generatedAt: "2030-01-01T00:00:00Z" }),
			"the concept's generated.at (2030-01-01T00:00:00Z) is later than now, so a verification now would not count (OKF 0.3 5.3); run okfit sync, which re-stamps it, then mark verified again",
		);
	});
});
