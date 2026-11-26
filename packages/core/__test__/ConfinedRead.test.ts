import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem } from "effect";
import { ConfinementError, readConfinedBytes, readConfinedString } from "../src/ConfinedRead.js";
import { MOUNT, platform } from "./utils/fixtures.js";
import { swapPlatform } from "./utils/swapPlatform.js";

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

	it.effect("drops a leading BOM from the string, as Node's readFileString does, and keeps it in the bytes", () =>
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
			// control: with nothing swapped, the same read succeeds
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString(`${MOUNT}/real/a.md`), "SWAPPED\n");
		}).pipe(Effect.provide(layer));
	});
});
