import { assert, describe, it } from "@effect/vitest";
import type { MigrationFixPlan } from "@okfit/engine";
import { Cause, Effect, Exit, PlatformError } from "effect";
import { summaryRefusals } from "../../src/internal/migrationSummary.js";

describe("summaryRefusals", () => {
	it.effect("a failed plan counts no refusals (#506)", () =>
		Effect.gen(function* () {
			const plan = Effect.fail(
				PlatformError.systemError({
					_tag: "PermissionDenied",
					module: "FileSystem",
					method: "readFile",
					pathOrDescriptor: "a.md",
				}),
			);
			const refused = yield* summaryRefusals(plan);
			assert.deepStrictEqual(refused, []);
		}),
	);

	it.effect("a plan's refusals are reported by file and code", () =>
		Effect.gen(function* () {
			const plan: MigrationFixPlan = {
				edits: [],
				refused: [{ file: "a.md", code: "root-relative-path", reason: "x" }],
				drifts: [],
			};
			const refused = yield* summaryRefusals(Effect.succeed(plan));
			assert.deepStrictEqual(refused, [{ file: "a.md", code: "root-relative-path" }]);
		}),
	);

	it.effect("a defect is not swallowed", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(summaryRefusals(Effect.die("boom")));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) assert.isTrue(Cause.hasDies(exit.cause));
		}),
	);
});
