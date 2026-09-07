import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { projectResolver } from "../../src/config/projectResolver.js";

const makeTempDir = (): Promise<string> => mkdtemp(join(tmpdir(), "okfit-project-resolver-"));

const write = (path: string, body: string): Promise<void> => writeFile(path, body, "utf8");

const resolveFrom = (cwd: string) => projectResolver({ cwd }).resolve.pipe(Effect.provide(NodeServices.layer));

describe("projectResolver", () => {
	it.effect("finds .okfit.toml in the starting directory", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const path = join(dir, ".okfit.toml");
			yield* Effect.promise(() => write(path, 'bundle.path = "a"\n'));
			assert.deepStrictEqual(yield* resolveFrom(dir), Option.some(path));
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect("finds okfit.toml in the starting directory", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const path = join(dir, "okfit.toml");
			yield* Effect.promise(() => write(path, 'bundle.path = "a"\n'));
			assert.deepStrictEqual(yield* resolveFrom(dir), Option.some(path));
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect("finds .config/okfit.toml in the starting directory", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			yield* Effect.promise(() => mkdir(join(dir, ".config"), { recursive: true }));
			const path = join(dir, ".config", "okfit.toml");
			yield* Effect.promise(() => write(path, 'bundle.path = "a"\n'));
			assert.deepStrictEqual(yield* resolveFrom(dir), Option.some(path));
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect("prefers .okfit.toml over okfit.toml in the same directory", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const winner = join(dir, ".okfit.toml");
			yield* Effect.promise(() => write(winner, 'bundle.path = "dot"\n'));
			yield* Effect.promise(() => write(join(dir, "okfit.toml"), 'bundle.path = "plain"\n'));
			assert.deepStrictEqual(yield* resolveFrom(dir), Option.some(winner));
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect("prefers okfit.toml over .config/okfit.toml in the same directory", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			const winner = join(dir, "okfit.toml");
			yield* Effect.promise(() => write(winner, 'bundle.path = "plain"\n'));
			yield* Effect.promise(() => mkdir(join(dir, ".config"), { recursive: true }));
			yield* Effect.promise(() => write(join(dir, ".config", "okfit.toml"), 'bundle.path = "cfg"\n'));
			assert.deepStrictEqual(yield* resolveFrom(dir), Option.some(winner));
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect("a child's okfit.toml beats a parent's .okfit.toml", () =>
		Effect.gen(function* () {
			const parent = yield* Effect.promise(makeTempDir);
			const child = join(parent, "child");
			yield* Effect.promise(() => mkdir(child, { recursive: true }));
			yield* Effect.promise(() => write(join(parent, ".okfit.toml"), 'bundle.path = "parent"\n'));
			const winner = join(child, "okfit.toml");
			yield* Effect.promise(() => write(winner, 'bundle.path = "child"\n'));
			assert.deepStrictEqual(yield* resolveFrom(child), Option.some(winner));
			yield* Effect.promise(() => rm(parent, { recursive: true, force: true }));
		}),
	);

	it.effect("ascends past a directory with none of the three names", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(makeTempDir);
			const deep = join(root, "a", "b", "c");
			yield* Effect.promise(() => mkdir(deep, { recursive: true }));
			const winner = join(root, ".config", "okfit.toml");
			yield* Effect.promise(() => mkdir(join(root, ".config"), { recursive: true }));
			yield* Effect.promise(() => write(winner, 'bundle.path = "root"\n'));
			assert.deepStrictEqual(yield* resolveFrom(deep), Option.some(winner));
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
		}),
	);

	it.effect("returns none at the filesystem root with no match", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			assert.deepStrictEqual(yield* resolveFrom(dir), Option.none());
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);

	it.effect('reports name "project"', () =>
		Effect.sync(() => {
			assert.strictEqual(projectResolver({ cwd: "/nonexistent" }).name, "project");
		}),
	);

	it.effect("absorbs an unreadable directory into none rather than failing", () =>
		Effect.gen(function* () {
			const dir = yield* Effect.promise(makeTempDir);
			// A regular FILE where a directory is expected: every `exists` under it
			// fails with ENOTDIR, which `Walker.firstMatch` must absorb into `false`
			// (`Walker.ts:90-102`). Deterministic on every platform and uid, unlike a
			// chmod-000 directory, which a root-owned CI container ignores.
			const blocked = join(dir, "blocked");
			yield* Effect.promise(() => write(blocked, "not a directory\n"));
			const winner = join(dir, "okfit.toml");
			yield* Effect.promise(() => write(winner, 'bundle.path = "parent"\n'));
			assert.deepStrictEqual(yield* resolveFrom(blocked), Option.some(winner));
			yield* Effect.promise(() => rm(dir, { recursive: true, force: true }));
		}),
	);
});
