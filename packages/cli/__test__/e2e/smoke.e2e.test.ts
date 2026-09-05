import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

// Version-agnostic: proves the spawn/collect mechanics work against
// whatever bin is on the branch, independent of which later task rewrites
// `okfit --version`'s exact string (D2/D3 do not touch bin.ts).
describe("runOkfit", () => {
	it.effect("spawns the built bin and collects stdout, stderr, and the exit code", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const result = yield* runOkfit(["--version"], sandbox);
			assert.strictEqual(result.exitCode, 0);
			assert.match(result.stdout.trim(), /^okfit v\S+$/);
			assert.strictEqual(result.stderr, "");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("a non-zero exit is data, not a failure", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const result = yield* runOkfit(["--not-a-real-flag"], sandbox);
			assert.notStrictEqual(result.exitCode, 0);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
