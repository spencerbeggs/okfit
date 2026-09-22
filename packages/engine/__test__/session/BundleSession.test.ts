import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemFaults } from "@effected/memfs";
import { DateTime, Deferred, Effect, Exit, Fiber, FileSystem, Option } from "effect";
import { TestClock } from "effect/testing";
import type { RevalidateOptions } from "../../src/session/BundleSession.js";
import { BundleSession } from "../../src/session/BundleSession.js";
import { ROOT, SEED, moduleConcept, sessionConfig, sessionPlatform, sourceOf } from "../utils/bundle.js";

const now = DateTime.makeUnsafe("2026-09-22T00:00:00Z");
const edit: RevalidateOptions = { now, tier: "edit" };
const full: RevalidateOptions = { now, tier: "full" };
const make = (config = sessionConfig()) => BundleSession.make({ root: ROOT, config, profile: Option.none() });
const codesOf = (changed: ReadonlyMap<string, ReadonlyArray<{ readonly code: string }>>, file: string) =>
	changed.get(file)?.map((d) => d.code);

describe("BundleSession", () => {
	it.effect("the first revalidate of a clean bundle reports nothing; bundle() and graph() fill in", () =>
		Effect.gen(function* () {
			const session = yield* make();
			assert.isTrue(Option.isNone(yield* session.bundle()));
			const first = yield* session.revalidate(edit);
			assert.deepStrictEqual([...first.changed.keys()], []);
			assert.strictEqual(first.bundle.concepts.size, 2);
			assert.isTrue(Option.isSome(yield* session.bundle()));
			assert.isTrue(Option.isSome(yield* session.graph()));
			assert.isDefined(session.config().types?.Module);
		}).pipe(Effect.provide(sessionPlatform(SEED))),
	);

	it.effect("a broken link introduced in A reports A; fixing it reports A -> []", () =>
		Effect.gen(function* () {
			const session = yield* make();
			yield* session.revalidate(edit);
			yield* session.open(`${ROOT}/a.md`, moduleConcept("A", "See [C](c.md)."));
			const broken = yield* session.revalidate(edit);
			assert.deepStrictEqual([...broken.changed.keys()], ["a.md"]);
			assert.deepStrictEqual(codesOf(broken.changed, "a.md"), ["broken-links"]);
			yield* session.change(`${ROOT}/a.md`, moduleConcept("A", "See [B](b.md)."));
			const fixed = yield* session.revalidate(edit);
			assert.deepStrictEqual([...fixed.changed.entries()], [["a.md", []]]);
		}).pipe(Effect.provide(sessionPlatform(SEED))),
	);

	it.effect("a harmless change to B reports nothing, while a breaking change to B reports B (positive control)", () =>
		Effect.gen(function* () {
			const session = yield* make();
			yield* session.revalidate(edit);
			yield* session.open(`${ROOT}/b.md`, moduleConcept("B", "Reworded body, no links."));
			const harmless = yield* session.revalidate(edit);
			assert.strictEqual(harmless.changed.size, 0);
			yield* session.change(`${ROOT}/b.md`, moduleConcept("B", "See [Z](z.md)."));
			const breaking = yield* session.revalidate(edit);
			assert.deepStrictEqual([...breaking.changed.keys()], ["b.md"]);
		}).pipe(Effect.provide(sessionPlatform(SEED))),
	);

	it.effect("closing an unsaved broken document reverts to disk: A -> []", () =>
		Effect.gen(function* () {
			const session = yield* make();
			yield* session.revalidate(edit);
			yield* session.open(`${ROOT}/a.md`, moduleConcept("A", "See [C](c.md)."));
			assert.deepStrictEqual([...(yield* session.revalidate(edit)).changed.keys()], ["a.md"]);
			yield* session.close(`${ROOT}/a.md`);
			const reverted = yield* session.revalidate(edit);
			assert.deepStrictEqual([...reverted.changed.entries()], [["a.md", []]]);
		}).pipe(Effect.provide(sessionPlatform(SEED))),
	);

	it.effect("a not-open file whose link target is deleted on disk is reported", () =>
		Effect.gen(function* () {
			const session = yield* make();
			yield* session.revalidate(edit);
			const fs = yield* FileSystem.FileSystem;
			yield* fs.remove(`${ROOT}/b.md`);
			const outcome = yield* session.watchedFilesChanged([`${ROOT}/b.md`]);
			assert.isFalse(outcome.configChanged);
			const after = yield* session.revalidate(edit);
			assert.deepStrictEqual([...after.changed.keys()], ["a.md"]);
			assert.deepStrictEqual(codesOf(after.changed, "a.md"), ["broken-links"]);
		}).pipe(Effect.provide(sessionPlatform(SEED))),
	);

	it.effect("watchedFilesChanged flags each config discovery name and nothing else", () =>
		Effect.gen(function* () {
			const session = yield* make();
			assert.isTrue((yield* session.watchedFilesChanged(["/repo/.config/okfit.toml"])).configChanged);
			assert.isTrue((yield* session.watchedFilesChanged(["/repo/.okfit.toml"])).configChanged);
			assert.isTrue((yield* session.watchedFilesChanged(["/repo/okfit.toml"])).configChanged);
			assert.isFalse((yield* session.watchedFilesChanged([`${ROOT}/a.md`, "/repo/okfit.toml.bak"])).configChanged);
		}).pipe(Effect.provide(sessionPlatform(SEED))),
	);

	it.effect("a slower revalidate that started on older text cannot land after a newer one", () => {
		// The first underlying read of b.md (not open, so it reaches memfs) signals
		// `stalled` and then sleeps on the TestClock. a.md is open, so the overlay
		// serves it without touching memfs: the older run has already read a.md's
		// older text when it stalls on b.md.
		const stalled = Deferred.makeUnsafe<void>();
		let bReads = 0;
		const faults: MemoryFileSystemFaults = {
			readFileString: (file) =>
				file !== `${ROOT}/b.md` || bReads++ > 0
					? undefined
					: Deferred.succeed(stalled, undefined).pipe(
							Effect.andThen(Effect.sleep("1 second")),
							Effect.as(moduleConcept("B")),
						),
		};
		return Effect.gen(function* () {
			const session = yield* make();
			yield* session.open(`${ROOT}/a.md`, moduleConcept("A", "See [B](b.md)."));
			const older = yield* Effect.forkChild(session.revalidate(edit));
			yield* Deferred.await(stalled);
			yield* session.change(`${ROOT}/a.md`, moduleConcept("A", "NEWER See [C](c.md)."));
			const newer = yield* Effect.forkChild(session.revalidate(edit));
			// Give the newer run every chance to finish first if nothing holds it back.
			for (let i = 0; i < 100; i++) yield* Effect.yieldNow;
			yield* TestClock.adjust("1 second");
			const results = [yield* Fiber.join(older), yield* Fiber.join(newer)];
			const latest = Option.getOrThrow(yield* session.bundle());
			assert.include(sourceOf(latest, "a.md") ?? "", "NEWER");
			assert.strictEqual(results.filter((result) => result.changed.has("a.md")).length, 1);
		}).pipe(Effect.provide(sessionPlatform(SEED, faults)));
	});

	describe("provenance tier", () => {
		const legacy = `---\ntype: Module\ntitle: L\ngenerated:\n  by: human:okfit-test\n  at: 2020-01-01T00:00:00Z\n---\n\n# L\n\nBody.\n`;
		const seed = { ...SEED, [`${ROOT}/legacy.md`]: legacy };
		const driftOn = sessionConfig({ generated_at_drift: "info" });

		it.effect("tier edit skips the git walk: succeeds with Git/GitHistory doubles that die on any call", () =>
			Effect.gen(function* () {
				const session = yield* make(driftOn);
				const result = yield* session.revalidate(edit);
				assert.strictEqual(result.bundle.concepts.size, 3);
			}).pipe(Effect.provide(sessionPlatform(seed))),
		);

		it.effect("tier full reaches the git walk (positive control: the same doubles fail it)", () =>
			Effect.gen(function* () {
				const session = yield* make(driftOn);
				const exit = yield* Effect.exit(session.revalidate(full));
				assert.isTrue(Exit.isFailure(exit));
			}).pipe(Effect.provide(sessionPlatform(seed))),
		);
	});
});
