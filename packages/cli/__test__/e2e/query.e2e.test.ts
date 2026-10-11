import { mkdir, readFile, writeFile } from "node:fs/promises";
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
			assert.match(r.stderr, /^\d+ concepts? in /);
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
			const json = await run(["query", "get", "project", "--format", "json"], cwd, env);
			assert.strictEqual(json.exitCode, 0);
			const body = JSON.parse(json.stdout) as { concept: { frontmatter: Record<string, unknown> } };
			assert.isFalse("raw" in body.concept.frontmatter);
			assert.strictEqual(body.concept.frontmatter.type, "Project");
			assert.strictEqual(body.concept.frontmatter.status, "draft");
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("get nope exits 64 (a usage error); --format json prints the K-22 error envelope", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const human = await run(["query", "get", "nope"], cwd, env);
			assert.strictEqual(human.exitCode, 64);
			assert.include(human.stderr, "nope");
			const r = await run(["query", "get", "nope", "--format", "json"], cwd, env);
			assert.strictEqual(r.exitCode, 64);
			const body = JSON.parse(r.stdout) as { error?: unknown; schema?: unknown; okfit_version?: unknown };
			assert.isDefined(body.error);
			assert.isDefined(body.schema);
			assert.isDefined(body.okfit_version);
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
			assert.isTrue((body.incoming as Array<{ id: string }>).some((n) => n.id === "glossary/zeta"));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--root: list and get work from another cwd", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const elsewhere = dirname(cwd);
			const list = await run(["query", "list", "--root", cwd], elsewhere, env);
			assert.strictEqual(list.exitCode, 0);
			const get = await run(["query", "get", "project", "--root", cwd], elsewhere, env);
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

	describe("trust signal filters", () => {
		const NOW = "2026-10-09T12:00:00Z";
		const concept = (name: string, extra = ""): string =>
			`---\ntype: Glossary\ndescription: ${name}.\nstatus: stable\n${extra}---\n\n# ${name}\n\nOriginal body.\n`;

		/** current (bound, untouched), drifted (bound, then body edited), unverified, stale (past stale_after). */
		const trustSandbox = async () => {
			const { sandbox, cwd, env: baseline } = await seeded();
			const env = {
				...baseline,
				GIT_CONFIG_GLOBAL: join(sandbox.env.HOME ?? "", ".gitconfig"),
				GIT_CONFIG_NOSYSTEM: "1",
				OKFIT_NOW: NOW,
			};
			await writeFile(
				join(sandbox.env.HOME ?? "", ".gitconfig"),
				"[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n",
				"utf8",
			);
			await write(cwd, "trust/current.md", concept("Current"));
			await write(cwd, "trust/drifted.md", concept("Drifted"));
			await write(cwd, "trust/unverified.md", concept("Unverified"));
			await write(cwd, "trust/stale.md", concept("Stale", "stale_after: 2020-01-01T00:00:00Z\n"));
			for (const id of ["trust/current", "trust/drifted"]) {
				const verify = await run(["verify", id, "--format", "json"], cwd, env);
				assert.strictEqual(verify.exitCode, 0, verify.stderr);
			}
			const file = join(cwd, "okf", "trust", "drifted.md");
			await writeFile(file, (await readFile(file, "utf8")).replace("Original body.", "Edited body."), "utf8");
			return { sandbox, cwd, env };
		};

		const idsOf = async (args: ReadonlyArray<string>, cwd: string, env: Record<string, string>) => {
			const r = await run(["query", "list", ...args, "--format", "json"], cwd, env);
			assert.strictEqual(r.exitCode, 0, r.stderr);
			const body = JSON.parse(r.stdout) as { items: Array<{ id: string }> };
			return body.items.map((i) => i.id).filter((id) => id.startsWith("trust/"));
		};

		it("selects each flag's result set", async () => {
			const { sandbox, cwd, env } = await trustSandbox();
			try {
				assert.deepStrictEqual(await idsOf(["--verified"], cwd, env), ["trust/current"]);
				assert.deepStrictEqual(await idsOf(["--drifted"], cwd, env), ["trust/drifted"]);
				assert.deepStrictEqual(await idsOf(["--unverified"], cwd, env), ["trust/stale", "trust/unverified"]);
				assert.deepStrictEqual(await idsOf(["--stale"], cwd, env), ["trust/stale"]);
				assert.deepStrictEqual(await idsOf(["--drifted", "--status", "stable"], cwd, env), ["trust/drifted"]);
				assert.deepStrictEqual(await idsOf(["--drifted", "--status", "draft"], cwd, env), []);
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("list shows the trust column; get shows tier, integrity and stale", async () => {
			const { sandbox, cwd, env } = await trustSandbox();
			try {
				const list = await run(["query", "list"], cwd, env);
				const lines = list.stdout.split("\n");
				assert.include(lines, "trust/current  stable  human-reviewed  Glossary  current", list.stdout);
				assert.include(lines, "trust/drifted  stable  drifted  Glossary  drifted");
				assert.include(lines, "trust/stale  stable  unverified,stale  Glossary  stale");
				const get = await run(["query", "get", "trust/drifted"], cwd, env);
				assert.include(get.stdout, "tier: human-reviewed\n");
				assert.match(get.stdout, /integrity: drifted \(content-changed/);
				assert.include(get.stdout, "stale: no\n");
				const json = await run(["query", "get", "trust/drifted", "--format", "json"], cwd, env);
				const body = JSON.parse(json.stdout) as { concept: { integrity: string; drift: { reason: string } | null } };
				assert.strictEqual(body.concept.integrity, "drifted");
				assert.strictEqual(body.concept.drift?.reason, "content-changed");
				const ok = JSON.parse((await run(["query", "get", "trust/current", "--format", "json"], cwd, env)).stdout) as {
					concept: { drift: unknown };
				};
				assert.strictEqual(ok.concept.drift, null);
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("get: several targets return an array in order, one target stays an object", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const many = await run(
					["query", "get", "glossary/alpha", "okf/glossary/zeta.md", "--format", "json"],
					cwd,
					env,
				);
				assert.strictEqual(many.exitCode, 0, many.stderr);
				const items = JSON.parse(many.stdout) as Array<{ concept: { id: string } }>;
				assert.isTrue(Array.isArray(items));
				assert.deepStrictEqual(
					items.map((item) => item.concept.id),
					["glossary/alpha", "glossary/zeta"],
				);
				const one = await run(["query", "get", "glossary/alpha", "--format", "json"], cwd, env);
				assert.isFalse(Array.isArray(JSON.parse(one.stdout)));
				const human = await run(["query", "get", "glossary/alpha", "glossary/zeta"], cwd, env);
				assert.strictEqual(human.exitCode, 0, human.stderr);
				assert.include(human.stdout, "\n\nglossary/zeta\n");
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("get: an unknown target among good ones exits 64", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const r = await run(["query", "get", "glossary/alpha", "decisions/zzz"], cwd, env);
				assert.strictEqual(r.exitCode, 64);
				assert.strictEqual(r.stdout, "");
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("neighbors: accepts a path as well as an id", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const r = await run(["query", "neighbors", "okf/glossary/zeta.md", "--format", "json"], cwd, env);
				assert.strictEqual(r.exitCode, 0, r.stderr);
				assert.strictEqual((JSON.parse(r.stdout) as { id: string }).id, "glossary/zeta");
			} finally {
				await removeSandbox(sandbox);
			}
		});
	});
});
