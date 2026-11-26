import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Effect, Option, PlatformError } from "effect";
import { ConfinementError, readConfinedBytes, readConfinedString } from "../src/ConfinedRead.js";
import { MOUNT, platform } from "./utils/fixtures.js";
import { overridePlatform, swapPlatform } from "./utils/swapPlatform.js";

const seed = {
	[`${MOUNT}/real/a.md`]: "inside\n",
	[`${MOUNT}/bom.md`]: "﻿bom\n",
	[`${MOUNT}/leaf-out.md`]: MemoryFileSystem.symlink("/outside/secret.md"),
	[`${MOUNT}/leaf-dangling.md`]: MemoryFileSystem.symlink("/outside/nowhere.md"),
	[`${MOUNT}/leaf-in.md`]: MemoryFileSystem.symlink(`${MOUNT}/real/a.md`),
	[`${MOUNT}/dir-out`]: MemoryFileSystem.symlink("/outside/dir"),
	[`${MOUNT}/dir-dangling`]: MemoryFileSystem.symlink("/outside/nowhere"),
	[`${MOUNT}/dir-in`]: MemoryFileSystem.symlink(`${MOUNT}/real`),
	"/outside/secret.md": "SECRET\n",
	"/outside/dir/a.md": "SECRET\n",
};
const read = (relative: string) => readConfinedString(MOUNT, `${MOUNT}/${relative}`);

describe("readConfinedString (OKF 0.3 section 3.2)", () => {
	it.effect("reads a regular file, and one reached through a link that stays inside", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* read("real/a.md"), "inside\n");
			assert.strictEqual(yield* read("leaf-in.md"), "inside\n");
			assert.strictEqual(yield* read("dir-in/a.md"), "inside\n");
		}).pipe(Effect.provide(platform(seed))),
	);

	it.effect(
		"drops a leading BOM from the string, as Effect's FileSystem.readFileString does, and keeps it in the bytes",
		() =>
			Effect.gen(function* () {
				assert.strictEqual(yield* read("bom.md"), "bom\n");
				assert.strictEqual((yield* readConfinedBytes(MOUNT, `${MOUNT}/bom.md`)).length, 7);
			}).pipe(Effect.provide(platform(seed))),
	);

	const refused: ReadonlyArray<readonly [string, string, string]> = [
		["a leaf link out of the root", "leaf-out.md", "outside"],
		["a parent directory link out of the root", "dir-out/a.md", "outside"],
		["a missing file under a directory that links out", "dir-out/missing.md", "outside"],
		["a dangling leaf link", "leaf-dangling.md", "unresolvable"],
		["a file under a dangling directory link", "dir-dangling/a.md", "unresolvable"],
	];
	for (const [name, relative, reason] of refused) {
		it.effect(`refuses ${name} (${reason}) and never reads it`, () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(read(relative));
				assert.instanceOf(error, ConfinementError);
				assert.strictEqual((error as ConfinementError).reason, reason);
			}).pipe(Effect.provide(platform(seed))),
		);
	}

	it.effect("a missing file inside the root is the PlatformError NotFound, not a refusal", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(read("real/missing.md"));
			assert.strictEqual(error._tag, "PlatformError");
			if (error._tag === "PlatformError") assert.strictEqual(error.reason._tag, "NotFound");
		}).pipe(Effect.provide(platform(seed))),
	);

	it.effect("refuses a file swapped for another between the open and the identity compare", () => {
		const [layer, trap] = swapPlatform(seed, "lstat", "before", `${MOUNT}/real/a.md`, (fs) =>
			Effect.gen(function* () {
				yield* fs.remove(`${MOUNT}/real/a.md`);
				yield* fs.writeFileString(`${MOUNT}/real/a.md`, "SWAPPED\n");
			}),
		);
		return Effect.gen(function* () {
			const error = yield* Effect.flip(read("real/a.md"));
			assert.isTrue(trap.fired(), "the swap must have run");
			assert.instanceOf(error, ConfinementError);
			assert.strictEqual((error as ConfinementError).reason, "changed");
			assert.include((error as ConfinementError).message, "changed while it was read; try again");
			assert.notInclude((error as ConfinementError).message, "outside");
			// control: with nothing swapping now, the same confined read succeeds on the new file
			assert.strictEqual(yield* read("real/a.md"), "SWAPPED\n");
		}).pipe(Effect.provide(layer));
	});

	it.effect("refuses a path replaced by a link to the file that is already open (lstat, not stat)", () => {
		const target = `${MOUNT}/real/a.md`;
		const [layer, trap] = swapPlatform(seed, "lstat", "before", target, (fs) =>
			Effect.gen(function* () {
				yield* fs.rename(target, `${MOUNT}/real/moved.md`);
				yield* fs.symlink(`${MOUNT}/real/moved.md`, target);
			}),
		);
		return Effect.gen(function* () {
			const error = yield* Effect.flip(read("real/a.md"));
			assert.isTrue(trap.fired(), "the swap must have run");
			assert.strictEqual((error as ConfinementError).reason, "changed");
		}).pipe(Effect.provide(layer));
	});

	describe("what identity cannot be compared is refused as changed", () => {
		const target = `${MOUNT}/real/a.md`;
		const noIno = (info: FileSystem.File.Info): FileSystem.File.Info => ({ ...info, ino: Option.none() });
		const cases: ReadonlyArray<readonly [string, (fs: FileSystem.FileSystem) => Partial<FileSystem.FileSystem>]> = [
			[
				"the path's lstat has no ino",
				(fs) => ({ lstat: (p) => (p === target ? Effect.map(fs.lstat(p), noIno) : fs.lstat(p)) }),
			],
			[
				"the open file's stat has no ino",
				(fs) => ({
					open: (p, o) =>
						Effect.map(fs.open(p, o), (file) =>
							p === target ? { ...file, stat: Effect.map(file.stat, noIno) } : file,
						),
				}),
			],
			[
				"neither the open file nor the path has an ino (absent is refused, never equal)",
				(fs) => ({
					lstat: (p) => (p === target ? Effect.map(fs.lstat(p), noIno) : fs.lstat(p)),
					open: (p, o) =>
						Effect.map(fs.open(p, o), (file) =>
							p === target ? { ...file, stat: Effect.map(file.stat, noIno) } : file,
						),
				}),
			],
			[
				"the path's lstat is on another device",
				(fs) => ({
					lstat: (p) =>
						p === target ? Effect.map(fs.lstat(p), (info) => ({ ...info, dev: info.dev + 1n })) : fs.lstat(p),
				}),
			],
			[
				"the path's lstat is not a file",
				(fs) => ({
					lstat: (p) =>
						p === target ? Effect.map(fs.lstat(p), (info) => ({ ...info, type: "Directory" as const })) : fs.lstat(p),
				}),
			],
			[
				"the path stops resolving after confineReal resolved it (the real path must exist, not be a lexical tail)",
				(fs) => {
					let calls = 0;
					return {
						realPath: (p) =>
							p === target && ++calls > 1
								? Effect.fail(
										PlatformError.systemError({
											_tag: "NotFound",
											module: "FileSystem",
											method: "realPath",
											pathOrDescriptor: p,
										}),
									)
								: fs.realPath(p),
					};
				},
			],
			[
				"the second resolution lands somewhere else (a link above the file was swapped between the two)",
				(fs) => {
					let calls = 0;
					return {
						realPath: (p) => (p === target && ++calls > 1 ? Effect.succeed(`${MOUNT}/elsewhere/a.md`) : fs.realPath(p)),
					};
				},
			],
		];
		for (const [name, override] of cases) {
			it.effect(name, () =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(read("real/a.md"));
					assert.instanceOf(error, ConfinementError);
					assert.strictEqual((error as ConfinementError).reason, "changed");
				}).pipe(Effect.provide(overridePlatform(seed, override))),
			);
		}
		it.effect("control: with no override the same read succeeds", () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* read("real/a.md"), "inside\n");
			}).pipe(Effect.provide(overridePlatform(seed, () => ({})))),
		);
	});
});
