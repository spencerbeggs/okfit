import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Git } from "@effected/git";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { OkfitConfig } from "@okfit/core";
import { Derivation, GitHistory } from "@okfit/profiles";
import { DateTime, Effect, FileSystem, Layer, Option, Path } from "effect";
import { applySyncPlan, planSync } from "../../src/sync/run.js";
import { ROOT } from "../utils/bundle.js";

const AT = "2026-06-01T08:00:00Z";
const EDIT = "\n\nAn edit that landed after the load.\n";

/**
 * The race the stale check exists for: an edit landing between `Bundle.load` and the point a sync mode reads its target
 * again. The baseline `applySyncPlan` compares against must be what the load read, so that edit trips
 * `SyncPlanStaleError` instead of becoming the baseline and being overwritten.
 */
describe("planSync: the baseline is what the load read", () => {
	const stampedBody = "---\ntype: Module\ntitle: A\n---\n\n# A\n\nOld body.\n";
	const concept = (digest: string) =>
		`---\ntype: Module\ntitle: A\ngenerated:\n  by: human:ada\n  at: ${AT}\nx-okfit-integrity:\n  generated:\n    body: ${digest}\n---\n\n# A\n\nNew body.\n`;
	const baseSeed = (digest: string): MemoryFileSystemSeed => ({
		[`${ROOT}/a.md`]: concept(digest),
		[`${ROOT}/index.md`]: "# Stale\n",
		[`${ROOT}/log.md`]: "# Log\n\n## 2026-05-01\n\n* Added Old\n",
	});

	/** memfs whose `open` of `path` edits the file first on its `nth` call (1 is the load's own read). */
	const editedOnOpen = (seed: MemoryFileSystemSeed, path: string, nth: number) => {
		let calls = 0;
		return Layer.effect(FileSystem.FileSystem)(
			Effect.map(
				FileSystem.FileSystem,
				(fs): FileSystem.FileSystem => ({
					...fs,
					open: (target, options) =>
						target === path && ++calls === nth
							? Effect.gen(function* () {
									yield* fs.writeFileString(path, (yield* fs.readFileString(path)) + EDIT);
								}).pipe(Effect.orDie, Effect.andThen(fs.open(target, options)))
							: fs.open(target, options),
				}),
			),
		).pipe(Layer.provide(MemoryFileSystem.layerWith(seed)));
	};
	const platform = (
		fsLayer: Layer.Layer<FileSystem.FileSystem>,
		pathLog?: (fs: FileSystem.FileSystem) => Effect.Effect<void>,
	) =>
		Layer.mergeAll(
			fsLayer,
			Path.layer,
			NodeCrypto.layerDigest,
			Layer.unwrap(
				Effect.map(FileSystem.FileSystem, (fs) =>
					Git.layerTest({
						repoRoot: () => Effect.succeed("/repo"),
						show: (_cwd: string, _ref: string, file: string) =>
							fs.readFileString(`/repo/${file}`).pipe(Effect.map(Option.some), Effect.orDie),
					}),
				),
			).pipe(Layer.provide(fsLayer)),
			Layer.effect(GitHistory)(
				Effect.map(
					FileSystem.FileSystem,
					(fs) =>
						({
							pathLog: (_root: string, file: string) =>
								Effect.andThen(pathLog === undefined ? Effect.void : pathLog(fs), () =>
									Effect.succeed([
										{
											sha: "0123456789abcdef0123456789abcdef01234567",
											path: file,
											authoredAt: DateTime.makeUnsafe(AT),
											committedAt: DateTime.makeUnsafe(AT),
											authorName: "Author",
											authorEmail: "author@example.com",
										},
									]),
								),
						}) as unknown as GitHistory["Service"],
				),
			).pipe(Layer.provide(fsLayer)),
		);
	const options = (modes: ReadonlyArray<"generated" | "index" | "log">) => ({
		bundleRoot: ROOT,
		config: OkfitConfig.DEFAULTS,
		modes: new Set(modes),
		dryRun: true,
	});
	const digestOf = Derivation.bodyDigest(stampedBody).pipe(Effect.provide(NodeCrypto.layerDigest));

	for (const [mode, file, nth] of [
		["index", "index.md", 2],
		["log", "log.md", 2],
	] as const) {
		it.effect(`${mode}: an edit between the load and the plan-time read is refused at apply`, () =>
			Effect.gen(function* () {
				const seed = baseSeed(yield* digestOf);
				const layer = platform(editedOnOpen(seed, `${ROOT}/${file}`, nth));
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const plan = yield* planSync(options([mode]));
					assert.isTrue(plan.pending.some((write) => write.target === `${ROOT}/${file}`));
					assert.include(yield* fs.readFileString(`${ROOT}/${file}`), "An edit that landed");
					const error = yield* Effect.flip(applySyncPlan(plan));
					if (error._tag !== "SyncPlanStaleError") return assert.fail(`unexpected ${error._tag}`);
					assert.deepStrictEqual(error.paths, [`${ROOT}/${file}`]);
					assert.include(yield* fs.readFileString(`${ROOT}/${file}`), "An edit that landed");
				}).pipe(Effect.provide(layer));
			}),
		);
	}

	it.effect("generated: an edit between the load and the plan is refused at apply", () =>
		Effect.gen(function* () {
			const seed = baseSeed(yield* digestOf);
			const layer = platform(MemoryFileSystem.layerWith(seed), (fs) =>
				Effect.orDie(fs.writeFileString(`${ROOT}/a.md`, concept("0".repeat(64)) + EDIT)),
			);
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const plan = yield* planSync(options(["generated"]));
				assert.deepStrictEqual(plan.result.generated.written, ["a"]);
				const error = yield* Effect.flip(applySyncPlan(plan));
				if (error._tag !== "SyncPlanStaleError") return assert.fail(`unexpected ${error._tag}`);
				assert.deepStrictEqual(error.paths, [`${ROOT}/a.md`]);
				assert.include(yield* fs.readFileString(`${ROOT}/a.md`), "An edit that landed");
			}).pipe(Effect.provide(layer));
		}),
	);

	const HAND = "# Hand-made\n\nWritten by a person after the load.\n";
	const without = (seed: MemoryFileSystemSeed, file: string): MemoryFileSystemSeed =>
		Object.fromEntries(Object.entries(seed).filter(([key]) => key !== `${ROOT}/${file}`));

	/** memfs where `method` of `path` creates the file with `HAND` first, once, if it is absent: a person making it. */
	const createdOn = (seed: MemoryFileSystemSeed, method: "open" | "readFileString", path: string) => {
		let done = false;
		return Layer.effect(FileSystem.FileSystem)(
			Effect.map(FileSystem.FileSystem, (fs): FileSystem.FileSystem => {
				const create = Effect.suspend(() => {
					if (done) return Effect.void;
					done = true;
					return fs.writeFileString(path, HAND);
				}).pipe(Effect.orDie);
				return method === "open"
					? {
							...fs,
							open: (target, opts) =>
								target === path ? create.pipe(Effect.andThen(fs.open(target, opts))) : fs.open(target, opts),
						}
					: {
							...fs,
							readFileString: (target, encoding) =>
								target === path
									? create.pipe(Effect.andThen(fs.readFileString(target, encoding)))
									: fs.readFileString(target, encoding),
						};
			}),
		).pipe(Layer.provide(MemoryFileSystem.layerWith(seed)));
	};

	it.effect(
		"index: an index.md absent at the load and created before the plan is refused at apply, never overwritten",
		() =>
			Effect.gen(function* () {
				const seed = without(baseSeed(yield* digestOf), "index.md");
				const layer = platform(createdOn(seed, "open", `${ROOT}/index.md`));
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const plan = yield* planSync(options(["index"]));
					const write = plan.pending.find((entry) => entry.target === `${ROOT}/index.md`);
					assert.isDefined(write);
					assert.strictEqual(write?.before, null);
					const error = yield* Effect.flip(applySyncPlan(plan));
					if (error._tag !== "SyncPlanStaleError") return assert.fail(`unexpected ${error._tag}`);
					assert.deepStrictEqual(error.paths, [`${ROOT}/index.md`]);
					assert.strictEqual(yield* fs.readFileString(`${ROOT}/index.md`), HAND);
				}).pipe(Effect.provide(layer));
			}),
	);

	it.effect("index: an index.md absent through the plan read but created before the plan's snapshot is refused", () =>
		Effect.gen(function* () {
			const seed = without(baseSeed(yield* digestOf), "index.md");
			const layer = platform(createdOn(seed, "readFileString", `${ROOT}/index.md`));
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const plan = yield* planSync(options(["index"]));
				const error = yield* Effect.flip(applySyncPlan(plan));
				if (error._tag !== "SyncPlanStaleError") return assert.fail(`unexpected ${error._tag}`);
				assert.deepStrictEqual(error.paths, [`${ROOT}/index.md`]);
				assert.strictEqual(yield* fs.readFileString(`${ROOT}/index.md`), HAND);
			}).pipe(Effect.provide(layer));
		}),
	);

	it.effect("log: a log.md created after the load is not read as unparseable and not rewritten: sync again", () =>
		Effect.gen(function* () {
			const seed = without(baseSeed(yield* digestOf), "log.md");
			const layer = platform(createdOn(seed, "open", `${ROOT}/log.md`));
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const plan = yield* planSync(options(["log"]));
				assert.deepStrictEqual(plan.result.log.skipped, [{ id: "log.md", reason: "changed-during-read" }]);
				assert.isFalse(plan.pending.some((entry) => entry.target === `${ROOT}/log.md`));
				assert.strictEqual(yield* fs.readFileString(`${ROOT}/log.md`), HAND);
			}).pipe(Effect.provide(layer));
		}),
	);

	it.effect("log: a log.md absent through the plan read but created before the plan's snapshot is refused", () =>
		Effect.gen(function* () {
			const seed = without(baseSeed(yield* digestOf), "log.md");
			const layer = platform(createdOn(seed, "readFileString", `${ROOT}/log.md`));
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const plan = yield* planSync(options(["log"]));
				const write = plan.pending.find((entry) => entry.target === `${ROOT}/log.md`);
				assert.strictEqual(write?.before, null);
				const error = yield* Effect.flip(applySyncPlan(plan));
				if (error._tag !== "SyncPlanStaleError") return assert.fail(`unexpected ${error._tag}`);
				assert.deepStrictEqual(error.paths, [`${ROOT}/log.md`]);
				assert.strictEqual(yield* fs.readFileString(`${ROOT}/log.md`), HAND);
			}).pipe(Effect.provide(layer));
		}),
	);

	it.effect("control: with no file created, an absent index.md is written", () =>
		Effect.gen(function* () {
			const seed = without(baseSeed(yield* digestOf), "index.md");
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const plan = yield* planSync(options(["index"]));
				yield* applySyncPlan(plan);
				assert.include(yield* fs.readFileString(`${ROOT}/index.md`), "# ");
			}).pipe(Effect.provide(platform(MemoryFileSystem.layerWith(seed))));
		}),
	);
});
