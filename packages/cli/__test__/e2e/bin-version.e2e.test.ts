import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { CLI_VERSION } from "../../src/version.js";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

describe("okfit bin", () => {
	it.effect("prints its own version dynamically, never a literal (K-32)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			try {
				const result = yield* runOkfit(["--version"], sandbox);
				assert.strictEqual(result.stdout.trim(), `okfit v${CLI_VERSION}`);
				assert.strictEqual(result.exitCode, 0);
			} finally {
				yield* Effect.promise(() => removeSandbox(sandbox));
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("bare okfit prints help and exits 0 (K-5)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			try {
				const result = yield* runOkfit([], sandbox);
				assert.strictEqual(result.exitCode, 0);
				assert.isTrue(result.stdout.includes("okfit"));
			} finally {
				yield* Effect.promise(() => removeSandbox(sandbox));
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("an unknown flag exits 64 (K-7, K-30, BSD EX_USAGE)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			try {
				const result = yield* runOkfit(["--bogus-flag"], sandbox);
				assert.strictEqual(result.exitCode, 64);
			} finally {
				yield* Effect.promise(() => removeSandbox(sandbox));
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
