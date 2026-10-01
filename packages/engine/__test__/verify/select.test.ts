import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { Actor } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Effect, Exit } from "effect";
import { resolveBatchTypes, selectAttestable, selectPickerCandidates } from "../../src/verify/select.js";

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

describe("selectPickerCandidates (picker)", () => {
	const concept = (type: string, title: string, extra = ""): string =>
		`---\ntype: ${type}\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const by = (actor: string): string => `  - by: ${actor}\n    at: 2026-09-01T00:00:00Z\n`;
	const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
		types: { Decision: { require_verified: true }, Gotcha: { require_verified: true }, Module: {} },
		actors: { humans: ["human:ada" as Actor] },
		extensions: {},
	});

	it.effect(
		"lists unattested require_verified concepts incl. drafts, excluding deprecated and own, sorted type then id",
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-picker-")));
				try {
					yield* Effect.promise(() => mkdir(join(root, "decisions")));
					yield* Effect.promise(() => mkdir(join(root, "gotchas")));
					const files: ReadonlyArray<readonly [string, string]> = [
						["gotchas/z.md", concept("Gotcha", "Z")],
						["decisions/b.md", concept("Decision", "B", "description: bee\nstatus: draft\n")],
						["decisions/a.md", concept("Decision", "A", `verified:\n${by("human:bob")}${by("agent:x")}`)],
						["decisions/c.md", concept("Decision", "C", "status: deprecated\n")],
						["decisions/d.md", concept("Decision", "D", `verified:\n${by("human:ada")}${by("human:bob")}`)],
						["module.md", concept("Module", "M")],
					];
					for (const [name, text] of files) yield* Effect.promise(() => writeFile(join(root, name), text));
					const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(NodeServices.layer));
					const rows = selectPickerCandidates(bundle, config, "human:ada");
					assert.deepStrictEqual(rows, [
						{
							id: "decisions/a",
							type: "Decision",
							status: "stable",
							title: "A",
							description: null,
							otherAttestations: 2,
						},
						{
							id: "decisions/b",
							type: "Decision",
							status: "draft",
							title: "B",
							description: "bee",
							otherAttestations: 0,
						},
						{ id: "gotchas/z", type: "Gotcha", status: "stable", title: "Z", description: null, otherAttestations: 0 },
					]);
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
	);
});
