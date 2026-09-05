// Proves the K-13 fix: an unset `HOME` reaches `CliRuntime.reportFailures`'s
// `exitCode: 3` fallback and `renderFailure`, instead of escaping to
// `NodeRuntime.runMain`'s own fatal-error path (a stack trace on stdout,
// exit 1) — see `src/bin.ts`'s `PlatformLayer` docstring.

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

describe("okfit bin: unset HOME", () => {
	it.effect("exits 3 with a single rendered error line, never a stack trace on stdout (K-13)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-cli-no-home-", { home: false }));
			try {
				const result = yield* runOkfit(["validate"], sandbox);

				assert.strictEqual(result.exitCode, 3);
				assert.strictEqual(result.stdout, "");
				assert.strictEqual(result.stderr, "error: XdgEnvError: The HOME environment variable is not set\n");
			} finally {
				yield* Effect.promise(() => removeSandbox(sandbox));
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
