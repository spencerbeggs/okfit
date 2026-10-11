import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { runContextTrust } from "../../src/trust/run.js";

const now = DateTime.makeUnsafe("2026-10-09T12:00:00Z");

describe("runContextTrust", () => {
	it.effect("caps stale_ids at the first five, sorted, while counting every stale concept", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-trust-")));
			// Written out of sorted order on purpose.
			for (const name of ["g", "c", "a", "f", "b", "e", "d"]) {
				const file = join(root, "t", `${name}.md`);
				yield* Effect.promise(async () => {
					await mkdir(dirname(file), { recursive: true });
					await writeFile(
						file,
						`---\ntype: Glossary\ndescription: ${name}.\nstale_after: 2020-01-01T00:00:00Z\n---\n\n# ${name}\n`,
						"utf8",
					);
				});
			}
			const summary = yield* runContextTrust({ bundleRoot: root, now });
			yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			assert.strictEqual(summary.concepts, 7);
			assert.strictEqual(summary.stale, 7);
			assert.strictEqual(summary.drifted, 0);
			assert.deepStrictEqual(summary.stale_ids, ["t/a", "t/b", "t/c", "t/d", "t/e"]);
			assert.deepStrictEqual(summary.drifted_ids, []);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
