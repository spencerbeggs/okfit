/**
 * Test-shaped probe — it.effect + assert.* for Effect-typed probes, plain it
 * for sync ones; discovered as the "scratchpad" vitest project (local only,
 * never CI). Disposable — reset reseeds it.
 *
 * Run from the repo root:
 *   pnpm exec vitest run --project scratchpad --coverage.enabled=false
 * (without the flag the repo's global coverage thresholds fail any
 * project-scoped run), or via the vitest-agent MCP run_tests tool — there,
 * read the Tests line, not the exit code.
 */
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Bundle } from "@okfit/core";
import { Effect, Layer, Path, Result } from "effect";
import { assertSuccess } from "./utils/assert-result.js";

const ROOT = "/repo/okf";
const seed = {
	[`${ROOT}/a.md`]: "---\ntype: Module\ntitle: A\n---\n\n# A\n\nSee [B](b.md).\n",
	[`${ROOT}/b.md`]: "---\ntype: Module\ntitle: B\n---\n\n# B\n\nBody.\n",
};
const platform = Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

describe("probe", () => {
	it.effect("settles a semantics question with typed evidence", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT }).pipe(Effect.provide(platform));
			assert.strictEqual(bundle.concepts.size, 2);
		}),
	);

	it("unwraps Results through the utils helpers, never raw access", () => {
		assert.strictEqual(assertSuccess(Result.succeed(1)), 1);
	});
});
