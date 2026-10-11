import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Git, GitCommandError } from "@effected/git";
import type { Actor } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Trust } from "@okfit/profiles";
import { DateTime, Effect, Exit, Layer } from "effect";
import { loadPreviews } from "../../src/verify/run.js";
import type { PickerCandidate } from "../../src/verify/select.js";
import { resolveBatchTypes, selectAttestable, selectPickerCandidates } from "../../src/verify/select.js";
import { DIGEST, bindFixtures } from "../utils/binding.js";
import { commit, initRepo, withDir } from "../utils/git.js";

const NOW = DateTime.makeUnsafe("2026-10-09T00:00:00Z");

describe("selectAttestable (issues #138, #143)", () => {
	const decision = (title: string, extra = ""): string =>
		`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n`;
	const entry = (by: string): string => `verified:\n  - by: ${by}\n    at: 2026-09-01T00:00:00Z\n`;
	const binding = (by: string, content = DIGEST): string =>
		`integrity:\n  verified:\n    by: ${by}\n    at: 2026-09-01T00:00:00Z\n    content: ${content}\n`;
	const boundByAda = entry("human:ada") + binding("human:ada");

	it.effect("skips drafts, deprecated and still-bound; offers drifted, unbound and another actor's", () =>
		Effect.gen(function* () {
			const root = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "okfit-select-")));
			try {
				yield* Effect.promise(() => mkdir(join(root, "decisions")));
				const files: ReadonlyArray<readonly [string, string]> = [
					["a", decision("A")],
					["b", decision("B", "status: draft\n")],
					["c", decision("C", "status: deprecated\n")],
					["d", decision("D", boundByAda)],
					["e", decision("E", `status: deprecated\n${boundByAda}`)],
					// verified by ada, but no binding records what was verified: drifted (unbound)
					["f", decision("F", entry("human:ada"))],
					// bound, then the content digest no longer matches: drifted (content-changed)
					["g", decision("G", entry("human:ada") + binding("human:ada", "0123456789abcdef"))],
					// current, but bound to another actor
					["h", decision("H", entry("human:bob") + binding("human:bob"))],
				];
				for (const [name, text] of files) {
					yield* Effect.promise(() => writeFile(join(root, "decisions", `${name}.md`), text));
				}
				yield* Effect.promise(() => writeFile(join(root, "module.md"), "---\ntype: Module\ntitle: M\n---\n\n# M\n"));
				yield* bindFixtures(root, ["decisions/d.md", "decisions/e.md", "decisions/h.md"]).pipe(
					Effect.provide(NodeServices.layer),
				);
				const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(NodeServices.layer));
				const signals = yield* Trust.signals(bundle, NOW).pipe(Effect.provide(NodeServices.layer));
				assert.strictEqual(signals.get("decisions/d")?.integrity, "current");
				assert.strictEqual(signals.get("decisions/f")?.drift?.reason, "unbound");
				assert.strictEqual(signals.get("decisions/g")?.drift?.reason, "content-changed");
				const selection = selectAttestable(bundle, new Set(["Decision"]), "human:ada", signals);
				assert.deepStrictEqual(
					selection.candidates.map((concept) => concept.id),
					["decisions/a", "decisions/f", "decisions/g", "decisions/h"],
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
						[
							"decisions/b.md",
							concept("Decision", "B", "description: bee\nstatus: draft\nstale_after: 2020-01-01T00:00:00Z\n"),
						],
						["decisions/a.md", concept("Decision", "A", `verified:\n${by("human:bob")}${by("agent:x")}`)],
						["decisions/c.md", concept("Decision", "C", "status: deprecated\n")],
						[
							"decisions/d.md",
							concept(
								"Decision",
								"D",
								`verified:\n${by("human:ada")}${by("human:bob")}integrity:\n  verified:\n    by: human:bob\n    at: 2026-09-01T00:00:00Z\n    content: ${DIGEST}\n`,
							),
						],
						[
							"decisions/e.md",
							concept(
								"Decision",
								"E",
								`verified:\n${by("human:ada")}integrity:\n  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: ${DIGEST}\n`,
							),
						],
						["module.md", concept("Module", "M")],
					];
					for (const [name, text] of files) yield* Effect.promise(() => writeFile(join(root, name), text));
					yield* bindFixtures(root, ["decisions/d.md", "decisions/e.md"]).pipe(Effect.provide(NodeServices.layer));
					const bundle = yield* Bundle.load({ root }).pipe(Effect.provide(NodeServices.layer));
					const signals = yield* Trust.signals(bundle, NOW).pipe(Effect.provide(NodeServices.layer));
					const rows = selectPickerCandidates(bundle, config, "human:ada", signals);
					assert.deepStrictEqual(rows, [
						{
							id: "decisions/a",
							path: "decisions/a.md",
							boundAt: null,
							type: "Decision",
							status: "stable",
							title: "A",
							description: null,
							otherAttestations: 2,
							integrity: "drifted",
							stale: false,
						},
						{
							id: "decisions/b",
							path: "decisions/b.md",
							boundAt: null,
							type: "Decision",
							status: "draft",
							title: "B",
							description: "bee",
							otherAttestations: 0,
							integrity: "none",
							stale: true,
						},
						{
							id: "decisions/d",
							path: "decisions/d.md",
							boundAt: "2026-09-01T00:00:00.000Z",
							type: "Decision",
							status: "stable",
							title: "D",
							description: null,
							otherAttestations: 1,
							integrity: "current",
							stale: false,
						},
						{
							id: "gotchas/z",
							path: "gotchas/z.md",
							boundAt: null,
							type: "Gotcha",
							status: "stable",
							title: "Z",
							description: null,
							otherAttestations: 0,
							integrity: "none",
							stale: false,
						},
					]);
				} finally {
					yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
				}
			}),
	);
});

describe("loadPreviews (verify picker diff preview)", () => {
	const platform = Layer.mergeAll(Git.layer, NodeServices.layer).pipe(Layer.provide(NodeServices.layer));
	const layer = Layer.mergeAll(platform, NodeServices.layer);
	const candidate = (id: string, path: string, integrity: PickerCandidate["integrity"], boundAt: string | null) =>
		({
			id,
			type: "Decision",
			status: "stable",
			title: null,
			description: null,
			otherAttestations: 0,
			integrity,
			stale: false,
			path,
			boundAt,
		}) satisfies PickerCandidate;

	it.effect("diffs a drifted candidate inside a repository and skips every row that is not drifted", () =>
		withDir("okfit-preview-", (dir) =>
			Effect.gen(function* () {
				initRepo(dir);
				const drifted = join(dir, "a.md");
				const current = join(dir, "b.md");
				yield* Effect.promise(() => writeFile(drifted, "one\n"));
				yield* Effect.promise(() => writeFile(current, "same\n"));
				commit(dir, "first", "2026-09-01T00:00:00Z");
				yield* Effect.promise(() => writeFile(drifted, "one\ntwo\n"));
				const previews = yield* loadPreviews([
					candidate("a", drifted, "drifted", "2026-09-05T00:00:00.000Z"),
					candidate("b", current, "current", "2026-09-05T00:00:00.000Z"),
					candidate("c", join(dir, "c.md"), "none", null),
					candidate("u", join(dir, "u.md"), "drifted", null),
				]);
				assert.deepStrictEqual([...previews.keys()], ["a", "u"]);
				const a = previews.get("a");
				assert.strictEqual(a?._tag, "diff");
				if (a?._tag !== "diff") return;
				assert.match(a.baseline, /^[0-9a-f]{7}$/);
				assert.include(a.patch, "@@");
				assert.include(a.patch, "+two");
				assert.deepStrictEqual(previews.get("u"), { _tag: "no-baseline", reason: "unbound" });
			}).pipe(Effect.provide(layer)),
		),
	);

	it.effect("a drifted candidate outside a repository is no-baseline not-a-repository", () =>
		withDir("okfit-preview-", (dir) =>
			Effect.gen(function* () {
				const file = join(dir, "a.md");
				yield* Effect.promise(() => writeFile(file, "one\n"));
				const previews = yield* loadPreviews([candidate("a", file, "drifted", "2026-09-05T00:00:00.000Z")]);
				assert.deepStrictEqual(previews.get("a"), { _tag: "no-baseline", reason: "not-a-repository" });
			}).pipe(Effect.provide(layer)),
		),
	);

	it.effect("a git command failure maps to no-baseline not-a-repository", () =>
		Effect.gen(function* () {
			const failing = Layer.succeed(Git, {
				log: (cwd: string) =>
					Effect.fail(new GitCommandError({ kind: "failed", args: ["log"], cwd, stderr: "boom", detail: "boom" })),
			} as unknown as Git["Service"]);
			const previews = yield* loadPreviews([
				candidate("a", "/nowhere/a.md", "drifted", "2026-09-05T00:00:00.000Z"),
			]).pipe(Effect.provide(Layer.mergeAll(failing, NodeServices.layer)));
			assert.deepStrictEqual(previews.get("a"), { _tag: "no-baseline", reason: "not-a-repository" });
		}),
	);
});
