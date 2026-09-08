import { symlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { CLI_VERSION } from "../../src/version.js";
import type { Sandbox } from "./utils/fixtures.js";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const withServices = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

const baseEnv = (env: Readonly<Record<string, string>>): Record<string, string> => ({
	...env,
	PATH: process.env.PATH ?? "",
	NO_COLOR: "1",
	// Probe C: a host /etc/gitconfig would otherwise leak a real identity
	// into every case, resolved or not.
	GIT_CONFIG_SYSTEM: "/dev/null",
});

/** A sandbox seeded with `okfit init` and a resolvable git identity (human:ada). */
const seeded = async (): Promise<{
	readonly sandbox: Sandbox;
	readonly cwd: string;
	readonly env: Record<string, string>;
}> => {
	const sandbox = await makeSandbox("okfit-verify-");
	const home = sandbox.env.HOME;
	if (home === undefined) throw new Error("expected a HOME in the sandbox env");
	await writeFile(join(home, ".gitconfig"), "[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n", "utf8");
	const env = baseEnv(sandbox.env);
	const init = await withServices(runOkfit(["init"], { cwd: sandbox.cwd, env }));
	assert.strictEqual(init.exitCode, 0);
	return { sandbox, cwd: sandbox.cwd, env };
};

/** The same seed with git identity made UNRESOLVABLE in both scopes. */
const seededWithoutIdentity = async (): Promise<{
	readonly sandbox: Sandbox;
	readonly cwd: string;
	readonly env: Record<string, string>;
}> => {
	const sandbox = await makeSandbox("okfit-verify-noid-");
	const env = { ...baseEnv(sandbox.env), GIT_CONFIG_GLOBAL: "/dev/null" };
	const init = await withServices(runOkfit(["init"], { cwd: sandbox.cwd, env }));
	assert.strictEqual(init.exitCode, 0);
	return { sandbox, cwd: sandbox.cwd, env };
};

const projectPath = (cwd: string): string => join(cwd, "okf", "project.md");
const readProject = (cwd: string): Promise<string> => readFile(projectPath(cwd), "utf8");

describe("okfit verify (e2e)", () => {
	it("verifies a freshly scaffolded concept: exit 0, one verified entry, every other byte unchanged", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);

			const run = await withServices(
				runOkfit(["verify", "project"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" } }),
			);

			assert.strictEqual(run.exitCode, 0);
			assert.strictEqual(run.stdout, "verified project by human:ada at 2026-09-07T00:00:00Z\n");

			const after = await readProject(cwd);
			assert.strictEqual(
				after,
				before.replace(
					"status: draft\n",
					"status: draft\nverified:\n  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n",
				),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("appends on a second run by the same actor and never touches the first entry (V-1, V-2)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await withServices(
				runOkfit(["verify", "project"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" } }),
			);
			const afterFirst = await readProject(cwd);

			const second = await withServices(
				runOkfit(["verify", "project"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-07T12:03:00.000Z" } }),
			);

			assert.strictEqual(second.exitCode, 0);
			assert.strictEqual(
				second.stdout,
				"already verified by human:ada at 2026-09-07T00:00:00Z; appending\n" +
					"verified project by human:ada at 2026-09-07T12:03:00Z\n",
			);

			const afterSecond = await readProject(cwd);
			// The first entry's bytes are identical: the second run is a pure
			// insertion after them.
			const firstEntry = "  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n";
			assert.isTrue(afterFirst.includes(firstEntry));
			assert.isTrue(afterSecond.includes(firstEntry));
			assert.strictEqual(
				afterSecond,
				afterFirst.replace(firstEntry, `${firstEntry}  - by: human:ada\n    at: 2026-09-07T12:03:00Z\n`),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("exits 3 on an unknown id and leaves the tree byte-identical", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);

			const run = await withServices(runOkfit(["verify", "decisions/no-such-thing"], { cwd, env }));

			assert.strictEqual(run.exitCode, 3);
			assert.isTrue(run.stderr.includes('error: no concept "decisions/no-such-thing" in this bundle (not-a-concept)'));
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("exits 3 on a reserved id (verify index)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const run = await withServices(runOkfit(["verify", "index"], { cwd, env }));
			assert.strictEqual(run.exitCode, 3);
			assert.isTrue(run.stderr.includes('error: no concept "index" in this bundle (reserved)'));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--dry-run exits 0, prints the fragment it would write, and writes nothing (I3)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);

			const run = await withServices(
				runOkfit(["verify", "project", "--dry-run"], {
					cwd,
					env: { ...env, OKFIT_NOW: "2026-09-07T12:04:00.000Z" },
				}),
			);

			assert.strictEqual(run.exitCode, 0);
			assert.strictEqual(
				run.stdout,
				"would verify project by human:ada at 2026-09-07T12:04:00Z (dry run, nothing written)\n" +
					"would write:\n" +
					"  verified:\n" +
					"    - by: human:ada\n" +
					"      at: 2026-09-07T12:04:00Z\n",
			);
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--at wins over OKFIT_NOW and is recorded verbatim", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const run = await withServices(
				runOkfit(["verify", "project", "--at", "2020-01-01T00:00:00Z"], {
					cwd,
					env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" },
				}),
			);

			assert.strictEqual(run.exitCode, 0);
			assert.strictEqual(run.stdout, "verified project by human:ada at 2020-01-01T00:00:00Z\n");
			assert.isTrue((await readProject(cwd)).includes("    at: 2020-01-01T00:00:00Z\n"));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("truncates the clock's own value to whole seconds, but never a caller-supplied --at", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const run = await withServices(
				runOkfit(["verify", "project"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.908Z" } }),
			);

			assert.strictEqual(run.exitCode, 0);
			assert.strictEqual(run.stdout, "verified project by human:ada at 2026-09-07T00:00:00Z\n");
			assert.isTrue((await readProject(cwd)).includes("    at: 2026-09-07T00:00:00Z\n"));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("rejects an --at without an explicit offset, exit 3, nothing written", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);

			const run = await withServices(runOkfit(["verify", "project", "--at", "2026-09-07T00:00:00"], { cwd, env }));

			assert.strictEqual(run.exitCode, 3);
			assert.isTrue(
				run.stderr.includes(
					"error: SchemaError(Expected an ISO 8601 timestamp with an explicit offset (Z, +hh:mm or -hh:mm))",
				),
			);
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--format json prints the success envelope and the K-22 error envelope", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const ok = await withServices(
				runOkfit(["verify", "project", "--format", "json"], {
					cwd,
					env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" },
				}),
			);
			assert.strictEqual(ok.exitCode, 0);
			const success = JSON.parse(ok.stdout) as Record<string, unknown>;
			assert.strictEqual(success.schema, 1);
			assert.strictEqual(success.okfit_version, CLI_VERSION);
			assert.strictEqual(success.id, "project");
			assert.strictEqual(success.path, "okf/project.md");
			assert.deepStrictEqual(success.verified, { by: "human:ada", at: "2026-09-07T00:00:00Z" });
			assert.strictEqual(success.dry_run, false);
			assert.strictEqual(success.exit_code, 0);

			const failed = await withServices(
				runOkfit(["verify", "decisions/no-such-thing", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(failed.exitCode, 3);
			const envelope = JSON.parse(failed.stdout) as Record<string, unknown>;
			assert.strictEqual(envelope.schema, 1);
			assert.strictEqual(envelope.okfit_version, CLI_VERSION);
			assert.strictEqual(envelope.exit_code, 3);
			assert.deepStrictEqual(envelope.error, {
				tag: "VerifyConceptNotFoundError",
				message: 'no concept "decisions/no-such-thing" in this bundle (not-a-concept)',
			});
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("exits 3 with the unresolved-actor message when git has no identity (V-7)", async () => {
		const { sandbox, cwd, env } = await seededWithoutIdentity();
		try {
			const before = await readProject(cwd);

			const run = await withServices(runOkfit(["verify", "project"], { cwd, env }));

			assert.strictEqual(run.exitCode, 3);
			// The catch-all renders `error: ${String(error)}`, and String() of a
			// Schema.TaggedError prefixes the tag (contract §12 note 6).
			assert.isTrue(
				run.stderr.includes(
					"error: HumanActorUnresolvedError: git has no user.name or user.email to derive a human actor from; set one or add actors.humans",
				),
			);
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("appends to a concept whose verified is a bare mapping, converting it to a list (D-17, V-13's flag)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const bare = [
				"---",
				"type: Decision",
				"title: Bare block mapping verified",
				"description: verified is a single bare block mapping, not yet a list.",
				"status: stable",
				"verified:",
				"  by: human:jsmith",
				"  at: 2026-01-02T00:00:00Z",
				"---",
				"",
				"# Bare block mapping verified",
				"",
			].join("\n");
			await writeFile(join(cwd, "okf", "decisions", "bare.md"), bare, "utf8");

			const run = await withServices(
				runOkfit(["verify", "decisions/bare"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" } }),
			);

			assert.strictEqual(run.exitCode, 0);
			assert.strictEqual(run.stdout, "verified decisions/bare by human:ada at 2026-09-07T00:00:00Z\n");
			assert.strictEqual(
				await readFile(join(cwd, "okf", "decisions", "bare.md"), "utf8"),
				bare.replace(
					"verified:\n  by: human:jsmith\n  at: 2026-01-02T00:00:00Z\n",
					"verified:\n  - by: human:jsmith\n    at: 2026-01-02T00:00:00Z\n  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n",
				),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("verifies a symlinked concept by rewriting its target, keeping the link intact (I4)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			// `okf/linked.md` is a symlink to a real file OUTSIDE the bundle
			// directory; `Bundle`'s walker follows it via `fs.stat` (typed
			// "File"), so it decodes as the concept id "linked".
			const targetPath = join(cwd, "linked-target.md");
			const before = await readProject(cwd);
			await writeFile(targetPath, before, "utf8");
			const linkPath = join(cwd, "okf", "linked.md");
			symlinkSync(targetPath, linkPath);

			const run = await withServices(
				runOkfit(["verify", "linked"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" } }),
			);

			assert.strictEqual(run.exitCode, 0);
			assert.strictEqual(run.stdout, "verified linked by human:ada at 2026-09-07T00:00:00Z\n");

			// The symlink itself is untouched; its target carries the write.
			const { lstatSync } = await import("node:fs");
			assert.isTrue(lstatSync(linkPath).isSymbolicLink());
			const target = await readFile(targetPath, "utf8");
			assert.strictEqual(
				target,
				before.replace(
					"status: draft\n",
					"status: draft\nverified:\n  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n",
				),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});
});
