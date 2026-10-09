import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Bundle, Derive } from "@okfit/core";
import { DateTime, Effect } from "effect";
import { selectStaleCandidates } from "../../src/verify/select.js";

describe("selectStaleCandidates (issue #228)", () => {
	const NOW = DateTime.makeUnsafe("2026-10-09T00:00:00Z");
	const doc = (type: string, extra: string): string => `---\ntype: ${type}\ntitle: T\n${extra}---\n\n# T\n`;
	const stale = 'stale_after: "2026-01-01T00:00:00Z"\n';
	const byAda = "verified:\n  - by: human:ada\n    at: 2026-01-01T00:00:00Z\n";

	it.effect("keeps stale non-deprecated concepts of any type, including ones the actor attested", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-stale-cand-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const files: ReadonlyArray<readonly [string, string]> = [
					["decisions/a.md", doc("Decision", stale + byAda)],
					["decisions/old.md", doc("Decision", `${stale}status: deprecated\n`)],
					["decisions/fresh.md", doc("Decision", 'stale_after: "2099-01-01T00:00:00Z"\n')],
					["mod.md", doc("Module", stale)],
				];
				for (const [name, text] of files) yield* Effect.promise(() => writeFile(join(root, name), text));
				const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(NodeServices.layer));
				const rows = selectStaleCandidates(bundle, Derive.staleReport(bundle, NOW), "human:ada");
				assert.deepStrictEqual(
					rows.map((row) => [row.id, row.type, row.otherAttestations]),
					[
						["decisions/a", "Decision", 0],
						["mod", "Module", 0],
					],
				);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});
