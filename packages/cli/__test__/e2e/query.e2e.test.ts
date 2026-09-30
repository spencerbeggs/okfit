import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Sandbox } from "./utils/fixtures.js";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const withServices = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

const baseEnv = (env: Readonly<Record<string, string>>): Record<string, string> => ({
	...env,
	PATH: process.env.PATH ?? "",
	NO_COLOR: "1",
	GIT_CONFIG_SYSTEM: "/dev/null",
});

const write = async (cwd: string, rel: string, content: string): Promise<void> => {
	const file = join(cwd, "okf", rel);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, content, "utf8");
};

/** A sandbox seeded with `okfit init` plus two extra concepts. */
const seeded = async (): Promise<{
	readonly sandbox: Sandbox;
	readonly cwd: string;
	readonly env: Record<string, string>;
}> => {
	const sandbox = await makeSandbox("okfit-query-");
	const env = baseEnv(sandbox.env);
	const init = await withServices(runOkfit(["init"], { cwd: sandbox.cwd, env }));
	assert.strictEqual(init.exitCode, 0);
	await write(
		sandbox.cwd,
		"glossary/zeta.md",
		"---\ntype: Glossary\ndescription: Zeta.\nstatus: stable\n---\n\n# Zeta\n\nSee [the project](../project.md).\n",
	);
	await write(
		sandbox.cwd,
		"glossary/alpha.md",
		"---\ntype: Glossary\ndescription: Alpha.\nstatus: draft\n---\n\n# Alpha\n",
	);
	return { sandbox, cwd: sandbox.cwd, env };
};

const run = (args: ReadonlyArray<string>, cwd: string, env: Record<string, string>) =>
	withServices(runOkfit(args, { cwd, env }));

describe("okfit query (e2e)", () => {
	it("list: exits 0 with one sorted line per concept", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const r = await run(["query", "list"], cwd, env);
			assert.strictEqual(r.exitCode, 0);
			const lines = r.stdout.trimEnd().split("\n");
			const ids = lines.map((l) => l.split("  ")[0]);
			assert.deepStrictEqual(ids, [...ids].sort());
			assert.include(ids, "glossary/alpha");
			assert.include(ids, "glossary/zeta");
			assert.include(ids, "project");
			assert.match(r.stderr, /^\d+ concepts in /);
			process.stdout.write(`--- query list ---\n${r.stdout}${r.stderr}`);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("list --status draft --format json: total equals items.length, all draft", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const r = await run(["query", "list", "--status", "draft", "--format", "json"], cwd, env);
			assert.strictEqual(r.exitCode, 0);
			const body = JSON.parse(r.stdout) as { total: number; items: Array<{ status: string }> };
			assert.isAbove(body.items.length, 0);
			assert.strictEqual(body.total, body.items.length);
			assert.isTrue(body.items.every((i) => i.status === "draft"));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("list --type Nope exits 64", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const r = await run(["query", "list", "--type", "Nope"], cwd, env);
			assert.strictEqual(r.exitCode, 64);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("list --verified --unverified exits 64", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const r = await run(["query", "list", "--verified", "--unverified"], cwd, env);
			assert.strictEqual(r.exitCode, 64);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("get project: exits 0, stdout starts with the bare id", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const r = await run(["query", "get", "project"], cwd, env);
			assert.strictEqual(r.exitCode, 0);
			assert.isTrue(r.stdout.startsWith("project\n"));
			process.stdout.write(`--- query get ---\n${r.stdout}`);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("get nope exits 3; --format json prints the K-22 error envelope", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const human = await run(["query", "get", "nope"], cwd, env);
			assert.strictEqual(human.exitCode, 3);
			const r = await run(["query", "get", "nope", "--format", "json"], cwd, env);
			assert.strictEqual(r.exitCode, 3);
			const body = JSON.parse(r.stdout) as { error?: unknown };
			assert.isDefined(body.error);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("neighbors project --format json: envelope with outgoing/incoming arrays", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const r = await run(["query", "neighbors", "project", "--format", "json"], cwd, env);
			assert.strictEqual(r.exitCode, 0);
			const body = JSON.parse(r.stdout) as { outgoing: unknown[]; incoming: unknown[] };
			assert.isTrue(Array.isArray(body.outgoing));
			assert.isTrue(Array.isArray(body.incoming));
			const human = await run(["query", "neighbors", "project"], cwd, env);
			process.stdout.write(`--- query neighbors ---\n${human.stdout}`);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("positionals: list <abs project> and get project <abs project> work from another cwd", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const elsewhere = dirname(cwd);
			const list = await run(["query", "list", cwd], elsewhere, env);
			assert.strictEqual(list.exitCode, 0);
			const get = await run(["query", "get", "project", cwd], elsewhere, env);
			assert.strictEqual(get.exitCode, 0);
			assert.isTrue(get.stdout.startsWith("project\n"));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("bare `okfit query` prints help naming the subcommands and exits 0", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const r = await run(["query"], cwd, env);
			assert.strictEqual(r.exitCode, 0);
			for (const name of ["list", "get", "neighbors"]) assert.include(r.stdout, name);
		} finally {
			await removeSandbox(sandbox);
		}
	});
});
