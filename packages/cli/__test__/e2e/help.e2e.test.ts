// Contract §6.2 `bin-version.e2e.test.ts` row's --help mentions, and §3.2's
// help-text table for `validate --help`/`init --help`. Each help invocation
// exits 0 with the help document on stdout and nothing on stderr.

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const withSandbox = (args: ReadonlyArray<string>, assertOn: (stdout: string) => void) =>
	Effect.gen(function* () {
		const sandbox = yield* Effect.promise(() => makeSandbox());
		try {
			const result = yield* runOkfit(args, sandbox);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "");
			assertOn(result.stdout);
		} finally {
			yield* Effect.promise(() => removeSandbox(sandbox));
		}
	}).pipe(Effect.provide(NodeServices.layer));

describe("okfit --help", () => {
	it.effect("mentions all three subcommands (K-33, contract §9.5)", () =>
		withSandbox(["--help"], (stdout) => {
			assert.isTrue(stdout.includes("validate"));
			assert.isTrue(stdout.includes("init"));
			assert.isTrue(stdout.includes("context"));
		}),
	);
});

describe("okfit validate --help", () => {
	it.effect("mentions path, --config, --format, human, and json (contract §3.2)", () =>
		withSandbox(["validate", "--help"], (stdout) => {
			assert.isTrue(stdout.includes("path"));
			assert.isTrue(stdout.includes("--config"));
			assert.isTrue(stdout.includes("--format"));
			assert.isTrue(stdout.includes("human"));
			assert.isTrue(stdout.includes("json"));
		}),
	);
});

describe("okfit init --help", () => {
	it.effect("mentions path, --config, and --profile (contract §3.2)", () =>
		withSandbox(["init", "--help"], (stdout) => {
			assert.isTrue(stdout.includes("path"));
			assert.isTrue(stdout.includes("--config"));
			assert.isTrue(stdout.includes("--profile"));
		}),
	);
});

describe("okfit context --help", () => {
	it.effect("mentions path, --config, --format, human, and json; never --profile (contract §9.5)", () =>
		withSandbox(["context", "--help"], (stdout) => {
			assert.isTrue(stdout.includes("path"));
			assert.isTrue(stdout.includes("--config"));
			assert.isTrue(stdout.includes("--format"));
			assert.isTrue(stdout.includes("human"));
			assert.isTrue(stdout.includes("json"));
			assert.isFalse(stdout.includes("--profile"));
		}),
	);
});
