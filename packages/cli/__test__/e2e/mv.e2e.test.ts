import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { writeTwoDecisions } from "./utils/concepts.js";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const withServices = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

const seeded = async () => {
	const sandbox = await makeSandbox("okfit-mv-");
	const env = { ...sandbox.env, PATH: process.env.PATH ?? "", NO_COLOR: "1" };
	const init = await withServices(runOkfit(["init"], { cwd: sandbox.cwd, env }));
	assert.strictEqual(init.exitCode, 0);
	await writeTwoDecisions(sandbox.cwd);
	const a = join(sandbox.cwd, "okf", "decisions", "a.md");
	await writeFile(a, `${await readFile(a, "utf8")}\nSee [b](b.md).\n`, "utf8");
	return { sandbox, cwd: sandbox.cwd, env };
};

describe("okfit mv (e2e)", () => {
	it("moves a concept and rewrites the link; refuses an existing destination; previews with --dry-run", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const moved = await withServices(runOkfit(["mv", "decisions/b", "decisions/beta"], { cwd, env }));
			assert.strictEqual(moved.exitCode, 0);
			assert.isTrue(existsSync(join(cwd, "okf", "decisions", "beta.md")));
			assert.isFalse(existsSync(join(cwd, "okf", "decisions", "b.md")));
			assert.include(await readFile(join(cwd, "okf", "decisions", "a.md"), "utf8"), "(beta.md)");

			const exists = await withServices(runOkfit(["mv", "decisions/beta", "decisions/a"], { cwd, env }));
			assert.strictEqual(exists.exitCode, 64);
			assert.include(exists.stderr + exists.stdout, "already exists");

			await mkdir(join(cwd, "okf", "topics"), { recursive: true });
			const dry = await withServices(
				runOkfit(["mv", "decisions/beta", "okf/topics/beta.md", "--dry-run", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(dry.exitCode, 0);
			const json = JSON.parse(dry.stdout);
			assert.strictEqual(json.dry_run, true);
			assert.isTrue(json.edits.some((edit: { path: string }) => edit.path === "topics/beta.md"));
			assert.isTrue(existsSync(join(cwd, "okf", "decisions", "beta.md")));
			assert.isFalse(existsSync(join(cwd, "okf", "topics", "beta.md")));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("refuses a destination that climbs out of the bundle, from inside okf/ and from the project root", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const okf = join(cwd, "okf");
			const runs = [
				await withServices(runOkfit(["mv", "decisions/b", "../x"], { cwd: okf, env })),
				await withServices(runOkfit(["mv", "decisions/b", "decisions/../../x"], { cwd: okf, env })),
				await withServices(runOkfit(["mv", "decisions/b", "../../escape", "--dry-run"], { cwd, env })),
			];
			for (const run of runs) {
				assert.strictEqual(run.exitCode, 64);
				assert.include(run.stderr + run.stdout, "outside the bundle");
			}
			assert.isTrue(existsSync(join(okf, "decisions", "b.md")));
			assert.isFalse(existsSync(join(cwd, "x.md")));
			assert.isFalse(existsSync(join(okf, "x.md")));
			assert.isFalse(existsSync(join(cwd, "..", "escape.md")));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("moves into an existing directory or a trailing-slash destination, accepts a leading slash, refuses whitespace", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const okf = join(cwd, "okf");
			await mkdir(join(okf, "topics"), { recursive: true });
			const into = await withServices(runOkfit(["mv", "decisions/b", "topics"], { cwd, env }));
			assert.strictEqual(into.exitCode, 0);
			assert.isTrue(existsSync(join(okf, "topics", "b.md")));
			const slash = await withServices(runOkfit(["mv", "topics/b", "decisions/", "--dry-run"], { cwd, env }));
			assert.strictEqual(slash.exitCode, 0);
			assert.isFalse(existsSync(join(okf, "decisions", "b.md")));
			const rooted = await withServices(runOkfit(["mv", "topics/b", "/decisions/walk2"], { cwd, env }));
			assert.strictEqual(rooted.exitCode, 0);
			assert.isTrue(existsSync(join(okf, "decisions", "walk2.md")));
			const spaced = await withServices(runOkfit(["mv", "decisions/walk2", "decisions/my file"], { cwd, env }));
			assert.strictEqual(spaced.exitCode, 64);
			assert.include(spaced.stderr + spaced.stdout, "whitespace");
			assert.isTrue(existsSync(join(okf, "decisions", "walk2.md")));
		} finally {
			await removeSandbox(sandbox);
		}
	});
});
