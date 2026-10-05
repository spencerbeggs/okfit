import { NodeServices } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

describe("okfit bin", () => {
	it.effect("prints okfit <semver> (engine <semver>, okf 0.2, config-schema 1.0) (okfit #137)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			try {
				const result = yield* runOkfit(["--version"], sandbox);
				assert.match(
					result.stdout.trim(),
					/^okfit \d+\.\d+\.\d+ \(engine \d+\.\d+\.\d+, okf 0\.2, config-schema 1\.0\)$/,
				);
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

	// The plugin hooks (`validate.sh`, `orientation.sh`) parse stdout as JSON, so
	// a usage error must leave stdout empty and put its help beside the errors.
	it.effect("a usage error's help and errors go to stderr, leaving stdout empty (helpOnUsageError)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			try {
				const result = yield* runOkfit(["validate", "--bogus-flag"], sandbox);
				assert.strictEqual(result.exitCode, 64);
				assert.strictEqual(result.stdout, "");
				assert.include(result.stderr, "--bogus-flag");
				assert.include(result.stderr, "--config");
				assert.include(result.stderr, "--format");
			} finally {
				yield* Effect.promise(() => removeSandbox(sandbox));
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("an explicit --help prints help on stdout and nothing on stderr", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			try {
				const result = yield* runOkfit(["validate", "--help"], sandbox);
				assert.strictEqual(result.exitCode, 0);
				assert.include(result.stdout, "--format");
				assert.strictEqual(result.stderr, "");
			} finally {
				yield* Effect.promise(() => removeSandbox(sandbox));
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("a bare command group prints help on stdout, exits 0 and writes nothing to stderr", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			try {
				const result = yield* runOkfit([], sandbox);
				assert.strictEqual(result.exitCode, 0);
				assert.include(result.stdout, "validate");
				assert.strictEqual(result.stderr, "");
			} finally {
				yield* Effect.promise(() => removeSandbox(sandbox));
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
