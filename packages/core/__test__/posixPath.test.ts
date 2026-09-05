import { assert, describe, it } from "@effect/vitest";
import { Effect, Path } from "effect";
import { basename, dirname, join, normalize } from "../src/internal/posixPath.js";

const NORMALIZE_CASES = [
	"",
	".",
	"./",
	"/",
	"a",
	"a/",
	"a/b/../c",
	"a/../..",
	"a/../../b",
	"../a",
	"./a/./b/",
	"/a/../../b",
	"//a//b",
	"metrics/../computations/revenue-ytd.md",
	"tables/index.md",
] as const;

const JOIN_CASES: ReadonlyArray<ReadonlyArray<string>> = [
	[],
	[""],
	["a", "b"],
	["", "a", "", "b/"],
	["metrics", "./gross-margin-legacy.md"],
	["computations", "../tables/orders.md"],
	["/repo/okf", "tables/orders.md"],
	[".", "index.md"],
];

const DIRNAME_CASES = ["", "/", "a", "a/b", "/a", "/a/", "a/b/", "a//b", "tables/orders.md", "index.md"] as const;

describe("internal/posixPath", () => {
	it.effect("normalize, join and dirname match Path.layer on every case", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			for (const input of NORMALIZE_CASES) assert.strictEqual(normalize(input), path.normalize(input), input);
			for (const parts of JOIN_CASES) assert.strictEqual(join(...parts), path.join(...parts), parts.join(","));
			for (const input of DIRNAME_CASES) assert.strictEqual(dirname(input), path.dirname(input), input);
		}).pipe(Effect.provide(Path.layer)),
	);

	it("keeps leading .. on relative input, clamps it on absolute input, keeps a trailing slash", () => {
		assert.strictEqual(normalize("a/../../b"), "../b");
		assert.strictEqual(normalize("/a/../../b"), "/b");
		assert.strictEqual(join("a", "subdir/"), "a/subdir/");
	});

	it("basename returns the last segment ignoring trailing slashes", () => {
		assert.strictEqual(basename("tables/index.md"), "index.md");
		assert.strictEqual(basename("index.md"), "index.md");
		assert.strictEqual(basename("a/b/"), "b");
		assert.strictEqual(basename("/"), "");
		assert.strictEqual(basename(""), "");
	});
});
