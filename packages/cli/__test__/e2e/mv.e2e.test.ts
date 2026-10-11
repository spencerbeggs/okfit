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
});
