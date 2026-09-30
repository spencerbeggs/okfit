import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Bundle } from "@okfit/core";
import { Effect } from "effect";
import { selectAttestable } from "../../src/verify/select.js";

describe("selectAttestable (issues #138, #143)", () => {
	const decision = (title: string, extra = ""): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const verifiedByAda = "verified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\n";

	it.effect("skips drafts, deprecated and already-verified; deprecated wins; other types are ignored", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-select-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const files: ReadonlyArray<readonly [string, string]> = [
					["a", decision("A")],
					["b", decision("B", "status: draft\n")],
					["c", decision("C", "status: deprecated\n")],
					["d", decision("D", verifiedByAda)],
					["e", decision("E", `status: deprecated\n${verifiedByAda}`)],
				];
				for (const [name, text] of files) {
					yield* Effect.promise(() => writeFile(join(root, "decisions", `${name}.md`), text));
				}
				yield* Effect.promise(() => writeFile(join(root, "module.md"), "---\ntype: Module\ntitle: M\n---\n\n# M\n"));
				const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(NodeServices.layer));
				const selection = selectAttestable(bundle, new Set(["Decision"]), "human:ada");
				assert.deepStrictEqual(
					selection.candidates.map((concept) => concept.id),
					["decisions/a"],
				);
				assert.deepStrictEqual(selection.skipped, [
					{ id: "decisions/b", reason: "draft" },
					{ id: "decisions/c", reason: "deprecated" },
					{ id: "decisions/d", reason: "already-verified" },
					{ id: "decisions/e", reason: "deprecated" },
				]);
			} finally {
				yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
			}
		}),
	);
});
