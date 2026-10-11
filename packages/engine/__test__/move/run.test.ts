import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { ActorPattern } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Trust } from "@okfit/profiles";
import { DateTime, Effect, Exit } from "effect";
import { MoveError } from "../../src/errors.js";
import { planMove, runMove } from "../../src/move/run.js";
import { DIGEST, bindFixtures } from "../utils/binding.js";

const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");
const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
	types: {
		Decision: { fields: { supersedes: { description: "Superseded.", kind: "path" } } },
		Convention: {},
		Publication: {},
	},
	actors: { humans: ["human:ada" as ActorPattern] },
	extensions: {},
});

const verified = `verified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\nintegrity:\n  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: ${DIGEST}\n`;
const decision = (title: string, extra: string, body: string) =>
	`---\ntype: Decision\ntitle: ${title}\n${extra}---\n\n# ${title}\n\n${body}\n`;

const files: Record<string, string> = {
	"index.md": "# Index\n\n* [B](decisions/b.md)\n",
	"log.md": "# Log\n",
	"decisions/a.md": decision("A", verified, "See [b](b.md)."),
	"decisions/b.md": decision("B", verified, "See [c](../conventions/c.md)."),
	"decisions/d.md": decision("D", "supersedes: b.md\n", "Replaces b."),
	"conventions/c.md": "---\ntype: Convention\ntitle: C\n---\n\n# C\n\nSee [x](../decisions/b.md).\n",
	"publications/p.md": "---\ntype: Publication\ntitle: P\nrenders:\n  - path: ../decisions/b.md\n---\n\n# P\n",
};

const snapshot = async (dir: string, base = dir): Promise<Record<string, string>> => {
	const out: Record<string, string> = {};
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) Object.assign(out, await snapshot(full, base));
		else out[full.slice(base.length + 1)] = await readFile(full, "utf8");
	}
	return out;
};

const withBundle = <A, E>(
	body: (project: string, okf: string) => Effect.Effect<A, E, NodeServices.NodeServices>,
	extra: Record<string, string> = {},
) =>
	Effect.gen(function* () {
		const project = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "okfit-move-"))));
		const okf = join(project, "okf");
		yield* Effect.promise(async () => {
			for (const [name, text] of Object.entries({ ...files, ...extra })) {
				await mkdir(join(okf, name, ".."), { recursive: true });
				await writeFile(join(okf, name), text);
			}
			await writeFile(join(project, "outside.md"), "# outside\n");
		});
		yield* bindFixtures(okf, ["decisions/a.md", "decisions/b.md"]);
		return yield* body(project, okf).pipe(
			Effect.ensuring(Effect.promise(() => rm(project, { recursive: true, force: true }))),
		);
	}).pipe(Effect.provide(NodeServices.layer));

const base = (okf: string, cwd: string, from: string, to: string) => ({
	from,
	to,
	cwd,
	bundleRoot: okf,
	config,
	now: AT,
});

const refusal = (effect: Effect.Effect<unknown, unknown, NodeServices.NodeServices>) =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(effect);
		const error = Exit.findErrorOption(exit);
		assert.isTrue(error._tag === "Some");
		return error._tag === "Some" ? error.value : undefined;
	});

describe("runMove", () => {
	it.effect("renames in place, rewrites every referrer's spelling and leaves the moved bytes alone", () =>
		withBundle((_project, okf) =>
			Effect.gen(function* () {
				const before = yield* Effect.promise(() => snapshot(okf));
				const { plan } = yield* runMove({
					...base(okf, okf, "decisions/b", "decisions/beta"),
					dryRun: false,
				});
				const after = yield* Effect.promise(() => snapshot(okf));
				assert.strictEqual(after["decisions/a.md"], before["decisions/a.md"]?.replace("(b.md)", "(beta.md)"));
				assert.strictEqual(
					after["conventions/c.md"],
					before["conventions/c.md"]?.replace("../decisions/b.md", "../decisions/beta.md"),
				);
				assert.strictEqual(
					after["decisions/d.md"],
					before["decisions/d.md"]?.replace("supersedes: b.md", "supersedes: beta.md"),
				);
				assert.strictEqual(
					after["publications/p.md"],
					before["publications/p.md"]?.replace("../decisions/b.md", "../decisions/beta.md"),
				);
				assert.strictEqual(after["decisions/beta.md"], before["decisions/b.md"]);
				assert.isUndefined(after["decisions/b.md"]);
				assert.strictEqual(after["index.md"], before["index.md"]);
				assert.strictEqual(after["log.md"], before["log.md"]);
				assert.deepStrictEqual(plan.drifts, ["decisions/a"]);
				assert.deepStrictEqual(
					plan.edits.map((edit) => [edit.path, edit.count]),
					[
						["conventions/c.md", 1],
						["decisions/a.md", 1],
						["decisions/beta.md", 0],
						["decisions/d.md", 1],
						["publications/p.md", 1],
					],
				);
				const bundle = yield* Bundle.load({ root: okf });
				const moved = bundle.concepts.get("decisions/beta" as never);
				if (moved === undefined) return yield* Effect.die(new Error("moved concept missing"));
				assert.strictEqual((yield* Trust.signal(moved, config, AT)).integrity, "current");
			}),
		),
	);

	it.effect("moves across directories, recomputes the moved file's links and reports both drifts", () =>
		withBundle((_project, okf) =>
			Effect.gen(function* () {
				const { plan } = yield* runMove({
					...base(okf, okf, "decisions/b", "topics/deep/beta"),
					dryRun: false,
				});
				const after = yield* Effect.promise(() => snapshot(okf));
				assert.include(after["topics/deep/beta.md"], "(../../conventions/c.md)");
				assert.include(after["decisions/a.md"], "(../topics/deep/beta.md)");
				assert.isUndefined(after["decisions/b.md"]);
				assert.deepStrictEqual(plan.drifts, ["decisions/a", "decisions/b"]);
			}),
		),
	);

	it.effect("a dry run plans the same move and writes nothing", () =>
		withBundle((_project, okf) =>
			Effect.gen(function* () {
				const before = yield* Effect.promise(() => snapshot(okf));
				const options = base(okf, okf, "decisions/b", "decisions/beta");
				const planned = yield* planMove(options);
				const dry = yield* runMove({ ...options, dryRun: true });
				assert.deepStrictEqual(dry.plan, planned);
				assert.isTrue(dry.dryRun);
				assert.deepStrictEqual(yield* Effect.promise(() => snapshot(okf)), before);
			}),
		),
	);

	it.effect("refuses an unusable destination or an unknown source and writes nothing", () =>
		withBundle((project, okf) =>
			Effect.gen(function* () {
				const before = yield* Effect.promise(() => snapshot(okf));
				const reason = (to: string, from = "decisions/b") =>
					refusal(runMove({ ...base(okf, okf, from, to), dryRun: false })).pipe(
						Effect.map((error) => (error instanceof MoveError ? error.reason : (error as { _tag: string })._tag)),
					);
				assert.strictEqual(yield* reason("decisions/a"), "destination-exists");
				assert.strictEqual(yield* reason(join(project, "outside")), "outside-bundle");
				assert.strictEqual(yield* reason("decisions/index"), "reserved");
				assert.strictEqual(yield* reason("decisions/b"), "same-path");
				assert.strictEqual(yield* reason("decisions/new", "decisions/ghost"), "TargetResolutionError");
				assert.deepStrictEqual(yield* Effect.promise(() => snapshot(okf)), before);
			}),
		),
	);

	it.effect("fails with unrewritable, listing the link, when a body URL cannot be located", () =>
		withBundle(
			(_project, okf) =>
				Effect.gen(function* () {
					const before = yield* Effect.promise(() => snapshot(okf));
					const error = yield* refusal(runMove({ ...base(okf, okf, "decisions/b", "decisions/beta"), dryRun: false }));
					assert.isTrue(error instanceof MoveError);
					if (error instanceof MoveError) {
						assert.strictEqual(error.reason, "unrewritable");
						assert.include(error.detail ?? "", "decisions/e.md: b_c.md");
					}
					assert.deepStrictEqual(yield* Effect.promise(() => snapshot(okf)), before);
				}),
			{ "decisions/b_c.md": decision("BC", "", "x"), "decisions/e.md": decision("E", "", "Escaped [x](b\\_c.md).") },
		),
	);

	it.effect("resolves the destination from the cwd-relative path or the id (R5')", () =>
		withBundle((project, okf) =>
			Effect.gen(function* () {
				const to = (cwd: string, dest: string) =>
					planMove(base(okf, cwd, "decisions/b", dest)).pipe(Effect.map((plan) => plan.to));
				assert.strictEqual(yield* to(join(okf, "decisions"), "beta.md"), "decisions/beta.md");
				assert.strictEqual(yield* to(project, "okf/topics/beta.md"), "topics/beta.md");
				assert.strictEqual(yield* to(project, "topics/beta"), "topics/beta.md");
			}),
		),
	);
});
