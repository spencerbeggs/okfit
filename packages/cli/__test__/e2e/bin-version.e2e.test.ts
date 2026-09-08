import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

describe("okfit bin", () => {
	it.effect("prints okfit v<semver> (K-32)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			try {
				const result = yield* runOkfit(["--version"], sandbox);
				assert.match(result.stdout.trim(), /^okfit v\d+\.\d+\.\d+/);
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
