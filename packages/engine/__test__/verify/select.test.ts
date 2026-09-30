import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { Actor } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Effect, Exit } from "effect";
import { resolveBatchTypes, selectAttestable } from "../../src/verify/select.js";

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

describe("resolveBatchTypes", () => {
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true }, Module: {}, Gotcha: { require_verified: false } },
		actors: { humans: ["human:ada" as Actor] },
		extensions: {},
	});

	it.effect("defaults to every type with require_verified = true", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual([...(yield* resolveBatchTypes(config, []))], ["Decision"]);
		}),
	);

	it.effect("returns explicit declared types as given", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual([...(yield* resolveBatchTypes(config, ["Module"]))], ["Module"]);
		}),
	);

	it.effect("fails an undeclared explicit type with unknown-type", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(resolveBatchTypes(config, ["Decision", "Nope"]));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				const error = exit.cause.reasons.map((r) => (r as { error?: unknown }).error)[0] as {
					reason: string;
					detail: string;
				};
				assert.strictEqual(error.reason, "unknown-type");
				assert.strictEqual(error.detail, "Nope");
			}
		}),
	);
});
