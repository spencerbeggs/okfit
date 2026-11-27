import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { escapesRoot } from "../src/confinement.js";
import { ROOT, seedPlatform } from "./utils/bundle.js";

const seed = {
	[`${ROOT}/real/a.md`]: "inside\n",
	[`${ROOT}/plain.md`]: "inside\n",
	[`${ROOT}/leaf-out.md`]: MemoryFileSystem.symlink("/outside/secret.md"),
	[`${ROOT}/leaf-dangling.md`]: MemoryFileSystem.symlink("/outside/nowhere.md"),
	[`${ROOT}/leaf-in.md`]: MemoryFileSystem.symlink(`${ROOT}/plain.md`),
	[`${ROOT}/dir-out`]: MemoryFileSystem.symlink("/outside/dir"),
	[`${ROOT}/dir-dangling`]: MemoryFileSystem.symlink("/outside/nowhere"),
	[`${ROOT}/dir-in`]: MemoryFileSystem.symlink(`${ROOT}/real`),
	"/outside/secret.md": "SECRET\n",
	"/outside/dir/a.md": "SECRET\n",
};

describe("escapesRoot (OKF 0.3 section 3.2)", () => {
	const cases: ReadonlyArray<readonly [string, string, boolean]> = [
		["a regular file", "plain.md", false],
		["a regular file under a real directory", "real/a.md", false],
		["a missing file (not an escape)", "missing.md", false],
		["a missing file under a real directory", "real/missing.md", false],
		["a leaf link out of the root", "leaf-out.md", true],
		["a dangling leaf link", "leaf-dangling.md", true],
		["a leaf link that stays inside", "leaf-in.md", false],
		["a regular file under a directory that links out", "dir-out/a.md", true],
		["a missing file under a directory that links out", "dir-out/missing.md", true],
		["a file under a dangling directory link", "dir-dangling/a.md", true],
		["a file under a directory link that stays inside", "dir-in/a.md", false],
	];
	for (const [name, relative, expected] of cases) {
		it.effect(`${name}: ${expected}`, () =>
			Effect.gen(function* () {
				assert.strictEqual(yield* escapesRoot(ROOT, relative), expected);
			}).pipe(Effect.provide(seedPlatform(seed))),
		);
	}
});
