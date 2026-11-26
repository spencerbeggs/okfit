import { symlinkSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ERROR_PROJECTS } from "../../../engine/__test__/fixtures/bundles.js";
import { writeTwoDecisions } from "./utils/concepts.js";
import { conceptDigest } from "./utils/digest.js";
import type { Sandbox } from "./utils/fixtures.js";
import { makeSandbox, removeSandbox, writeSeedInto } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";
import type { TestServices } from "./utils/platform.js";
import { TestPlatform } from "./utils/platform.js";
import { commit, initRepo } from "./utils/repo.js";

const withServices = <A, E>(effect: Effect.Effect<A, E, TestServices>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.provide(TestPlatform)));

const baseEnv = (env: Readonly<Record<string, string>>): Record<string, string> => ({
	...env,
	PATH: process.env.PATH ?? "",
	NO_COLOR: "1",
	// Probe C: a host /etc/gitconfig would otherwise leak a real identity
	// into every case, resolved or not.
	GIT_CONFIG_SYSTEM: "/dev/null",
});

/** The `x-okfit-integrity.verified` block a run by ada at `at` writes for the content digest `content`. */
const binding = (content: string, at = "2026-09-07T00:00:00Z"): string =>
	`x-okfit-integrity:\n  verified:\n    by: human:ada\n    at: ${at}\n    content: ${content}\n`;

/** The digest of concept `id`, computed here in the test process rather than by the bin under test. */
const digestOf = (cwd: string, id: string): Promise<string> =>
	withServices(conceptDigest(join(cwd, "okf"), id).pipe(Effect.orDie));

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

/**
 * A git sandbox whose concept `decisions/a` was stamped by a real `okfit sync` (so its recorded body digest matches) and
 * then had its committed `generated.at` moved to 2099 (#515). The body is untouched, so the digest still matches.
 */
const seededFutureStamp = async (): Promise<{
	readonly sandbox: Sandbox;
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly file: string;
}> => {
	const { sandbox, cwd, env } = await seeded();
	await writeTwoDecisions(cwd);
	const configPath = join(cwd, ".config", "okfit.toml");
	await writeFile(configPath, `${await readFile(configPath, "utf8")}\n[actors]\nagent = "agent:claude"\n`, "utf8");
	await initRepo(cwd, env);
	await commit(cwd, { message: "seed", authoredAt: "2026-09-01T00:00:00+00:00" }, env);
	const stamped = await withServices(runOkfit(["sync", "--only", "generated"], { cwd, env }));
	assert.strictEqual(stamped.exitCode, 0, stamped.stderr);
	const file = join(cwd, "okf", "decisions", "a.md");
	const text = await readFile(file, "utf8");
	assert.include(text, "at: 2026-09-01T00:00:00Z");
	await writeFile(file, text.replace("at: 2026-09-01T00:00:00Z", "at: 2099-01-01T00:00:00Z"), "utf8");
	await commit(cwd, { message: "future stamp", authoredAt: "2026-09-02T00:00:00+00:00" }, env);
	return { sandbox, cwd, env, file };
};

/** The usage message for a malformed `--at` (#513); the one wording the owner ruled on, shared by every assertion. */
const badAtMessage = (at: string): string =>
	`--at "${at}" is not a timestamp; give an ISO 8601 timestamp with an explicit offset (Z, +hh:mm or -hh:mm), such as 2026-11-25T12:00:00Z, or a date (YYYY-MM-DD, read as midnight UTC)`;

const projectPath = (cwd: string): string => join(cwd, "okf", "project.md");
const readProject = (cwd: string): Promise<string> => readFile(projectPath(cwd), "utf8");

describe("okfit verify (e2e)", () => {
	it("verifies a freshly scaffolded concept: exit 0, one verified entry, every other byte unchanged", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);
			const content = await digestOf(cwd, "project");

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
					`status: draft\nverified:\n  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n${binding(content)}`,
				),
			);
			// the binding still matches the written file: verifying again changes nothing it would call drift
			assert.strictEqual(await digestOf(cwd, "project"), content);
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
			// The first entry's bytes are identical: the second run is an insertion after them
			// plus the binding moving to the new entry.
			const firstEntry = "  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n";
			assert.isTrue(afterFirst.includes(firstEntry));
			assert.isTrue(afterSecond.includes(firstEntry));
			const content = await digestOf(cwd, "project");
			assert.strictEqual(
				afterSecond,
				afterFirst
					.replace(firstEntry, `${firstEntry}  - by: human:ada\n    at: 2026-09-07T12:03:00Z\n`)
					.replace(binding(content), binding(content, "2026-09-07T12:03:00Z")),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("exits 64 on an unknown id and leaves the tree byte-identical", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);

			const run = await withServices(runOkfit(["verify", "decisions/no-such-thing"], { cwd, env }));

			assert.strictEqual(run.exitCode, 64);
			assert.include(run.stderr, 'no concept "decisions/no-such-thing"');
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("verifies several targets in one batch, mixing an id and a path, with a trailing flag", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const run = await withServices(
				runOkfit(["verify", "decisions/a", "okf/decisions/b.md", "--dry-run"], {
					cwd,
					env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" },
				}),
			);
			assert.strictEqual(run.exitCode, 0);
			assert.include(run.stdout, "decisions/a");
			assert.include(run.stdout, "decisions/b");
			assert.notInclude(await readFile(join(cwd, "okf/decisions/a.md"), "utf8"), "verified:");
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("writes nothing when one target is bad, and names every bad one", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const before = await readFile(join(cwd, "okf/decisions/a.md"), "utf8");
			const run = await withServices(runOkfit(["verify", "decisions/a", "decisions/nope", "elsewhere"], { cwd, env }));
			assert.strictEqual(run.exitCode, 64);
			assert.include(run.stderr, 'no concept "decisions/nope"');
			assert.include(run.stderr, 'no concept "elsewhere"');
			assert.strictEqual(await readFile(join(cwd, "okf/decisions/a.md"), "utf8"), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("refuses targets together with --all", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const run = await withServices(runOkfit(["verify", "project", "--all"], { cwd, env }));
			assert.strictEqual(run.exitCode, 64);
			assert.include(run.stderr, "not both");
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("refuses --stable with more than one target", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const before = await readFile(join(cwd, "okf/decisions/a.md"), "utf8");
			const run = await withServices(runOkfit(["verify", "decisions/a", "decisions/b", "--stable"], { cwd, env }));
			assert.strictEqual(run.exitCode, 64);
			assert.include(run.stderr, "--stable and --draft need targets that name exactly one concept; these name 2");
			assert.notInclude(run.stderr, "batch mode");
			assert.strictEqual(await readFile(join(cwd, "okf/decisions/a.md"), "utf8"), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--stable and --draft accept one concept named more than once (#514)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const spellings = [
				["decisions/a", "okf/decisions/a.md"],
				["decisions/a", join(cwd, "okf/decisions/a.md")],
			];
			for (const flag of ["--stable", "--draft"]) {
				for (const targets of spellings) {
					const run = await withServices(
						runOkfit(["verify", ...targets, flag, "--dry-run", "--no-diff"], { cwd, env }),
					);
					assert.strictEqual(run.exitCode, 0, run.stderr);
					const lines = run.stdout.split("\n").filter((line) => line.startsWith("would verify decisions/a"));
					assert.lengthOf(lines, 1);
					assert.include(lines[0], "; status ");
				}
			}
			// A real run: one verified entry and one status change, not two.
			const before = await readFile(join(cwd, "okf/decisions/a.md"), "utf8");
			const real = await withServices(
				runOkfit(["verify", "decisions/a", "okf/decisions/a.md", "--stable", "--no-diff"], {
					cwd,
					env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" },
				}),
			);
			assert.strictEqual(real.exitCode, 0, real.stderr);
			const after = await readFile(join(cwd, "okf/decisions/a.md"), "utf8");
			assert.lengthOf(after.match(/^\s*- by: /gm) ?? [], (before.match(/^\s*- by: /gm) ?? []).length + 1);
			assert.lengthOf(after.match(/^status: stable$/gm) ?? [], 1);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("revokes several targets, and writes nothing when one has nothing to revoke", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const now = { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" };
			assert.strictEqual(
				(await withServices(runOkfit(["verify", "decisions/a", "decisions/b"], { cwd, env: now }))).exitCode,
				0,
			);
			const aVerified = await readFile(join(cwd, "okf/decisions/a.md"), "utf8");
			const refused = await withServices(runOkfit(["verify", "--revoke", "decisions/a", "project"], { cwd, env }));
			assert.notStrictEqual(refused.exitCode, 0);
			assert.strictEqual(await readFile(join(cwd, "okf/decisions/a.md"), "utf8"), aVerified);
			const run = await withServices(
				runOkfit(["verify", "--revoke", "decisions/a", "decisions/b", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(run.exitCode, 0);
			const body = JSON.parse(run.stdout);
			assert.isTrue(Array.isArray(body));
			assert.strictEqual(body.length, 2);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("a multi-target verify --revoke --dry-run reports each and writes nothing", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const now = { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" };
			await withServices(runOkfit(["verify", "decisions/a", "decisions/b"], { cwd, env: now }));
			const before = await Promise.all(
				["a", "b"].map((name) => readFile(join(cwd, `okf/decisions/${name}.md`), "utf8")),
			);
			const run = await withServices(
				runOkfit(["verify", "--revoke", "decisions/a", "decisions/b", "--dry-run", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(run.exitCode, 0);
			const body = JSON.parse(run.stdout);
			assert.strictEqual(body.length, 2);
			assert.isTrue(body.every((entry: { dry_run: boolean }) => entry.dry_run === true));
			const after = await Promise.all(
				["a", "b"].map((name) => readFile(join(cwd, `okf/decisions/${name}.md`), "utf8")),
			);
			assert.deepStrictEqual(after, before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("exits 64 on a reserved id (verify index)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const run = await withServices(runOkfit(["verify", "index"], { cwd, env }));
			assert.strictEqual(run.exitCode, 64);
			assert.include(run.stderr, '"index" is a reserved file, not a concept');
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

	it("rejects an --at without an explicit offset, exit 64, nothing written (#513)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);

			const run = await withServices(runOkfit(["verify", "project", "--at", "2026-09-07T00:00:00"], { cwd, env }));

			assert.strictEqual(run.exitCode, 64, run.stderr);
			assert.strictEqual(run.stderr, `error: ${badAtMessage("2026-09-07T00:00:00")}\n`);
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("a malformed --at is refused before the config is read (#513)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeFile(join(cwd, ".config", "okfit.toml"), "this is = = not toml [\n", "utf8");
			const now = { ...env, OKFIT_NOW: "2026-09-07T12:00:00.000Z" };

			// control: without --at the broken config is what refuses, exit 3
			const control = await withServices(runOkfit(["verify", "project", "--dry-run"], { cwd, env: now }));
			assert.strictEqual(control.exitCode, 3, control.stderr);

			const run = await withServices(runOkfit(["verify", "project", "--at", "nope"], { cwd, env: now }));
			assert.strictEqual(run.exitCode, 64, run.stderr);
			assert.strictEqual(run.stderr, `error: ${badAtMessage("nope")}\n`);

			// the one check that does come first: an explicit --config that does not exist is statted before the
			// handler runs (K-1), so it wins over a malformed --at
			const missing = join(cwd, "missing.toml");
			const statted = await withServices(
				runOkfit(["verify", "project", "--at", "nope", "--config", missing], { cwd, env: now }),
			);
			assert.strictEqual(statted.exitCode, 3, statted.stderr);
			assert.strictEqual(statted.stderr, `error: config path not found: ${missing}\n`);

			// the future --at refusal moves with it
			const future = await withServices(
				runOkfit(["verify", "project", "--at", "2099-01-01T00:00:00Z"], { cwd, env: now }),
			);
			assert.strictEqual(future.exitCode, 64, future.stderr);
			assert.include(future.stderr, "--at 2099-01-01T00:00:00Z is more than 5 minutes later than now");
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("a malformed --at is a usage error in JSON too (#513)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);
			const run = await withServices(runOkfit(["verify", "--all", "--at", "nope", "--format", "json"], { cwd, env }));

			assert.strictEqual(run.exitCode, 64, run.stderr);
			const lines = run.stdout.split("\n").filter((line) => line !== "");
			assert.strictEqual(lines.length, 1);
			const envelope = JSON.parse(lines[0] ?? "") as { exit_code: number; error: { tag: string; message: string } };
			assert.strictEqual(envelope.exit_code, 64);
			assert.strictEqual(envelope.error.tag, "VerifySelectionError");
			assert.strictEqual(envelope.error.message, badAtMessage("nope"));
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("still accepts a date and an explicit non-UTC offset for --at (#513)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const now = { ...env, OKFIT_NOW: "2026-09-07T12:00:00.000Z" };
			for (const at of ["2026-09-07", "2026-09-07T11:00:00+01:00"]) {
				const run = await withServices(runOkfit(["verify", "project", "--at", at, "--dry-run"], { cwd, env: now }));
				assert.strictEqual(run.exitCode, 0, `${at}: ${run.stderr}`);
			}
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("refuses an --at more than 5 minutes later than now, exit 64, nothing written (#503)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);
			const now = { ...env, OKFIT_NOW: "2026-09-07T12:00:00.000Z" };

			const run = await withServices(
				runOkfit(["verify", "project", "--at", "2026-09-07T12:05:01Z"], { cwd, env: now }),
			);

			assert.strictEqual(run.exitCode, 64, run.stderr);
			assert.include(
				run.stderr,
				"--at 2026-09-07T12:05:01Z is more than 5 minutes later than now; a verification records when the review happened, so give a time no later than now, or omit --at to record now",
			);
			assert.strictEqual(await readProject(cwd), before);

			// a malformed --at is a usage error too, with its own message (#513)
			const malformed = await withServices(runOkfit(["verify", "project", "--at", "tomorrow"], { cwd, env: now }));
			assert.strictEqual(malformed.exitCode, 64, malformed.stderr);
			assert.include(malformed.stderr, badAtMessage("tomorrow"));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("accepts an --at exactly 5 minutes ahead, refuses one second more (#503)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const now = { ...env, OKFIT_NOW: "2026-09-07T12:00:00.000Z" };
			const before = await readProject(cwd);

			const edge = await withServices(
				runOkfit(["verify", "project", "--at", "2026-09-07T12:05:00Z", "--dry-run"], { cwd, env: now }),
			);
			assert.strictEqual(edge.exitCode, 0, edge.stderr);
			assert.include(edge.stdout, "2026-09-07T12:05:00Z");

			const over = await withServices(
				runOkfit(["verify", "project", "--at", "2026-09-07T12:05:01Z", "--dry-run"], { cwd, env: now }),
			);
			assert.strictEqual(over.exitCode, 64, over.stderr);
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("the refusal comes before a batch and in JSON (#503)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const before = await readProject(cwd);
			const run = await withServices(
				runOkfit(["verify", "--all", "--at", "2099-01-01T00:00:00Z", "--format", "json"], {
					cwd,
					env: { ...env, OKFIT_NOW: "2026-09-07T12:00:00.000Z" },
				}),
			);

			assert.strictEqual(run.exitCode, 64, run.stderr);
			const lines = run.stdout.split("\n").filter((line) => line !== "");
			assert.strictEqual(lines.length, 1);
			const envelope = JSON.parse(lines[0] ?? "") as { exit_code: number; error: { tag: string; message: string } };
			assert.strictEqual(envelope.exit_code, 64);
			assert.strictEqual(envelope.error.tag, "VerifySelectionError");
			assert.strictEqual(
				envelope.error.message,
				"--at 2099-01-01T00:00:00Z is more than 5 minutes later than now; a verification records when the review happened, so give a time no later than now, or omit --at to record now",
			);
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("refuses an --at before generated.at (exit 3, file unchanged); --at equal to it exits 0 and writes", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const generated = "generated:\n  by: process:sync\n  at: 2026-09-07T12:00:00Z\n";
			const original = await readProject(cwd);
			assert.notInclude(original, "generated:");
			await writeFile(projectPath(cwd), original.replace(/^---\n/, `---\n${generated}`), "utf8");
			const before = await readProject(cwd);

			const refused = await withServices(runOkfit(["verify", "project", "--at", "2026-09-07T11:59:59Z"], { cwd, env }));
			assert.strictEqual(refused.exitCode, 3, refused.stderr);
			assert.include(
				refused.stderr,
				"was last changed at 2026-09-07T12:00:00Z, after the verification time 2026-09-07T11:59:59Z; a verification before the last change does not count (OKF 0.3 §5.3)",
			);
			assert.strictEqual(await readProject(cwd), before);

			const ok = await withServices(runOkfit(["verify", "project", "--at", "2026-09-07T12:00:00Z"], { cwd, env }));
			assert.strictEqual(ok.exitCode, 0, ok.stderr);
			const after = await readProject(cwd);
			assert.notStrictEqual(after, before);
			assert.include(after, "    at: 2026-09-07T12:00:00Z\n");
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("an --at with an offset is compared as an instant: +02:00 at generated.at writes, one second earlier refuses", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const original = await readProject(cwd);
			await writeFile(
				projectPath(cwd),
				original.replace(/^---\n/, "---\ngenerated:\n  by: process:sync\n  at: 2026-09-07T12:00:00Z\n"),
				"utf8",
			);
			const before = await readProject(cwd);
			const refused = await withServices(
				runOkfit(["verify", "project", "--at", "2026-09-07T13:59:59+02:00"], { cwd, env }),
			);
			assert.strictEqual(refused.exitCode, 3, refused.stderr);
			assert.include(refused.stderr, "was last changed at 2026-09-07T12:00:00Z");
			assert.strictEqual(await readProject(cwd), before);
			const ok = await withServices(runOkfit(["verify", "project", "--at", "2026-09-07T14:00:00+02:00"], { cwd, env }));
			assert.strictEqual(ok.exitCode, 0, ok.stderr);
			assert.notStrictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("verify --all prints the not-current skip line and exits 0", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const late = join(cwd, "okf", "decisions", "b.md");
			const lateText = (await readFile(late, "utf8")).replace(
				/^---\n/,
				"---\ngenerated:\n  by: process:sync\n  at: 2026-09-16T12:00:01Z\n",
			);
			await writeFile(late, lateText, "utf8");
			const run = await withServices(
				runOkfit(["verify", "--all"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-16T12:00:00Z" } }),
			);
			assert.strictEqual(run.exitCode, 0, run.stderr);
			assert.include(
				run.stdout,
				"skipped decisions/b: generated.at 2026-09-16T12:00:01Z is later than now by less than 5 minutes, so no verification made now would count yet; check the clock, or verify it again at or after 2026-09-16T12:00:01Z\n",
			);
			assert.include(run.stdout, "verified 1, skipped 1");
			assert.strictEqual(await readFile(late, "utf8"), lateText);
			assert.include(await readFile(join(cwd, "okf", "decisions", "a.md"), "utf8"), "by: human:ada");
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("an id list names the step per kind, matching the single-id refusal (#504)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const stamp = (title: string, at: string, extra = ""): string =>
				`---\ntype: Decision\ntitle: ${title}\ndescription: A decision.\nstatus: stable\n${extra}generated:\n  by: process:sync\n  at: ${at}\n---\n\n# ${title}\n`;
			const files = {
				future: stamp("Future", "2027-11-25T12:00:00Z"),
				near: stamp("Near", "2026-11-25T12:02:00Z"),
				blocked: stamp(
					"Blocked",
					"2027-11-25T12:00:00Z",
					"verified:\n  - by: human:ada\n    at: 2026-12-25T00:00:00Z\n",
				),
				absent: stamp("Absent", "2026-11-25T11:59:30Z"),
			};
			for (const [name, text] of Object.entries(files)) {
				await writeFile(join(cwd, "okf", "decisions", `${name}.md`), text, "utf8");
			}
			const runEnv = { ...env, OKFIT_NOW: "2026-11-25T12:00:00Z" };
			const at = ["--at", "2026-11-25T11:59:00Z"];
			const ids = ["decisions/a", "decisions/future", "decisions/near", "decisions/blocked", "decisions/absent"];
			const run = await withServices(runOkfit(["verify", ...ids, ...at], { cwd, env: runEnv }));
			assert.strictEqual(run.exitCode, 0, run.stderr);
			assert.include(
				run.stdout,
				[
					"skipped decisions/future: generated.at 2027-11-25T12:00:00Z is later than now, so no verification made now would count; commit any change to its body, then run okfit sync, which re-stamps it, then verify it again",
					"skipped decisions/near: generated.at 2026-11-25T12:02:00Z is later than now by less than 5 minutes, so no verification made now would count yet; check the clock, or verify it again at or after 2026-11-25T12:02:00Z",
					"skipped decisions/blocked: generated.at 2027-11-25T12:00:00Z is later than now, and okfit sync will not re-stamp it, because the verification dated 2026-12-25T00:00:00Z would then count without a re-verification; a human must correct generated.at or that verification",
					"skipped decisions/absent: generated.at 2026-11-25T11:59:30Z is later than the verification time 2026-11-25T11:59:00Z, so a verification then would not count; verify it at or after 2026-11-25T11:59:30Z, or omit --at to verify now",
					"",
				].join("\n"),
			);
			assert.include(run.stdout, "verified 1, skipped 4");
			// the JSON envelope's skipped entries stay {id, reason}: the next-step detail is for people only
			await writeFile(
				join(cwd, "okf", "decisions", "wip.md"),
				stamp("Wip", "2026-11-25T11:00:00Z").replace("status: stable", "status: wip"),
				"utf8",
			);
			const json = await withServices(
				runOkfit(["verify", ...ids, "decisions/wip", ...at, "--dry-run", "--format", "json"], { cwd, env: runEnv }),
			);
			assert.strictEqual(json.exitCode, 0, json.stderr);
			const { skipped } = JSON.parse(json.stdout) as { skipped: Array<{ id: string; reason: string }> };
			for (const entry of skipped) assert.deepStrictEqual(Object.keys(entry), ["id", "reason"], entry.id);
			const reasons = new Map(skipped.map((entry) => [entry.id, entry.reason]));
			assert.strictEqual(reasons.get("decisions/blocked"), "not-current");
			assert.strictEqual(reasons.get("decisions/wip"), "unknown-status");
			// each skipped id, alone, names the same step
			const steps: ReadonlyArray<readonly [string, string]> = [
				["decisions/future", "run okfit sync"],
				["decisions/near", "check the clock"],
				["decisions/blocked", "a human must correct generated.at or that verification"],
				["decisions/absent", "omit --at to verify now"],
			];
			for (const [id, step] of steps) {
				const alone = await withServices(runOkfit(["verify", id, ...at], { cwd, env: runEnv }));
				assert.strictEqual(alone.exitCode, 3, `${id}: ${alone.stderr}`);
				assert.include(alone.stderr.toLowerCase(), step, id);
			}
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--format json reports VerifyNotCurrentError in the error envelope, exit 3, nothing written", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const original = await readProject(cwd);
			await writeFile(
				projectPath(cwd),
				original.replace(/^---\n/, "---\ngenerated:\n  by: process:sync\n  at: 2026-09-07T12:00:00Z\n"),
				"utf8",
			);
			const before = await readProject(cwd);
			const failed = await withServices(
				runOkfit(["verify", "project", "--at", "2026-09-07T11:59:59Z", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(failed.exitCode, 3, failed.stderr);
			const envelope = JSON.parse(failed.stdout) as { exit_code: number; error: { tag: string; message: string } };
			assert.strictEqual(envelope.exit_code, 3);
			assert.strictEqual(envelope.error.tag, "VerifyNotCurrentError");
			assert.strictEqual(
				envelope.error.message,
				'"project" was last changed at 2026-09-07T12:00:00Z, after the verification time 2026-09-07T11:59:59Z; a verification before the last change does not count (OKF 0.3 §5.3). Verify at or after 2026-09-07T12:00:00Z, or omit --at to verify now',
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
			assert.match(String(success.okfit_version), /^\d+\.\d+\.\d+/);
			assert.match(String(success.engine_version), /^\d+\.\d+\.\d+/);
			assert.isNull(success.distribution);
			assert.strictEqual(success.id, "project");
			assert.strictEqual(success.path, "okf/project.md");
			assert.deepStrictEqual(success.verified, { by: "human:ada", at: "2026-09-07T00:00:00Z" });
			assert.strictEqual(success.dry_run, false);
			assert.strictEqual(success.exit_code, 0);

			const failed = await withServices(
				runOkfit(["verify", "decisions/no-such-thing", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(failed.exitCode, 64);
			const envelope = JSON.parse(failed.stdout) as Record<string, unknown>;
			assert.strictEqual(envelope.schema, 1);
			assert.match(String(envelope.okfit_version), /^\d+\.\d+\.\d+/);
			assert.strictEqual(envelope.exit_code, 64);
			assert.deepStrictEqual(envelope.error, {
				tag: "TargetResolutionError",
				message: 'no concept "decisions/no-such-thing"',
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
			const content = await digestOf(cwd, "decisions/bare");

			const run = await withServices(
				runOkfit(["verify", "decisions/bare"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-07T00:00:00.000Z" } }),
			);

			assert.strictEqual(run.exitCode, 0);
			// jsmith's unbound entry had drifted, but ada never verified it: first-time wording, no re-verify line
			assert.strictEqual(run.stdout, "verified decisions/bare by human:ada at 2026-09-07T00:00:00Z\n");
			assert.strictEqual(
				await readFile(join(cwd, "okf", "decisions", "bare.md"), "utf8"),
				bare.replace(
					"verified:\n  by: human:jsmith\n  at: 2026-01-02T00:00:00Z\n",
					`verified:\n  - by: human:jsmith\n    at: 2026-01-02T00:00:00Z\n  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n${binding(content)}`,
				),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("verifies a symlinked concept by rewriting its target, keeping the link intact (I4)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			// `okf/linked.md` is a symlink to a real file INSIDE the bundle
			// (a link that leaves the bundle is never loaded, OKF 0.3 3.2), so
			// it decodes as the concept id "linked".
			const targetPath = join(cwd, "okf", "linked-target.md");
			const before = await readProject(cwd);
			const content = await digestOf(cwd, "project");
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
					`status: draft\nverified:\n  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n${binding(content)}`,
				),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--all --dry-run prints one fragment per unverified require_verified concept, then --all records them (#138)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const decisions = join(cwd, "okf", "decisions");
			const write = (name: string, title: string, extra = "") =>
				writeFile(
					join(decisions, `${name}.md`),
					`---\ntype: Decision\ntitle: ${title}\ndescription: ${title}.\n${extra}---\n\n# ${title}\n`,
					"utf8",
				);
			await write("a", "A");
			await write("b", "B");
			await write("d", "D", "status: draft\n");

			const dry = await withServices(
				runOkfit(["verify", "--all", "--dry-run"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-16T12:00:00Z" } }),
			);
			assert.strictEqual(dry.exitCode, 0);
			assert.match(dry.stdout, /would verify decisions\/a by human:ada at 2026-09-16T12:00:00Z/);
			assert.match(dry.stdout, /would verify decisions\/b by human:ada/);
			assert.match(
				dry.stdout,
				/skipped decisions\/d: status draft, so a batch leaves it out; verify it on its own with okfit verify decisions\/d --stable/,
			);
			assert.match(dry.stdout, /would verify 2, skipped 1 \(dry run, nothing written\)/);
			assert.ok(!(await readFile(join(decisions, "a.md"), "utf8")).includes("verified:"));

			const real = await withServices(
				runOkfit(["verify", "--all", "--format", "json"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-16T12:00:00Z" } }),
			);
			assert.strictEqual(real.exitCode, 0);
			const envelope = JSON.parse(real.stdout) as {
				concepts: Array<{ id: string }>;
				skipped: Array<{ id: string; reason: string }>;
				verified_by: string;
			};
			assert.deepStrictEqual(
				envelope.concepts.map((c) => c.id),
				["decisions/a", "decisions/b"],
			);
			assert.deepStrictEqual(envelope.skipped, [{ id: "decisions/d", reason: "draft" }]);
			assert.ok(
				(await readFile(join(decisions, "a.md"), "utf8")).includes("  - by: human:ada\n    at: 2026-09-16T12:00:00Z\n"),
			);

			const again = await withServices(runOkfit(["verify", "--all", "--format", "json"], { cwd, env }));
			const second = JSON.parse(again.stdout) as { concepts: Array<unknown>; skipped: Array<{ reason: string }> };
			assert.deepStrictEqual(second.concepts, []);
			assert.ok(second.skipped.every((s) => s.reason === "already-verified" || s.reason === "draft"));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--all names the step for a draft and a deprecated concept, and the step works (#517)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const decisions = join(cwd, "okf", "decisions");
			const write = (name: string, extra: string) =>
				writeFile(
					join(decisions, `${name}.md`),
					`---\ntype: Decision\ntitle: ${name}\ndescription: ${name}.\n${extra}---\n\n# ${name}\n`,
					"utf8",
				);
			await write("d", "status: draft\n");
			await write("e", "status: deprecated\n");
			const dry = await withServices(
				runOkfit(["verify", "--all", "--dry-run"], { cwd, env: { ...env, OKFIT_NOW: "2026-09-16T12:00:00Z" } }),
			);
			assert.strictEqual(dry.exitCode, 0, dry.stderr);
			assert.include(
				dry.stdout,
				"skipped decisions/d: status draft, so a batch leaves it out; verify it on its own with okfit verify decisions/d --stable to settle it, or --draft to keep it a draft\n",
			);
			assert.include(
				dry.stdout,
				"skipped decisions/e: status deprecated, so a batch leaves it out, and a batch has nothing to verify while it is retired; if it is current again, set its status, or verify it with okfit verify decisions/e --stable\n",
			);
			// the suggested commands are accepted
			for (const args of [
				["verify", "decisions/d", "--stable", "--dry-run", "--no-diff"],
				["verify", "decisions/d", "--draft", "--dry-run", "--no-diff"],
				["verify", "decisions/e", "--stable", "--dry-run", "--no-diff"],
			]) {
				const run = await withServices(runOkfit(args, { cwd, env: { ...env, OKFIT_NOW: "2026-09-16T12:00:00Z" } }));
				assert.strictEqual(run.exitCode, 0, `${args.join(" ")}: ${run.stderr}`);
			}
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--type narrows the batch; no selection or id plus --all exits 64", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const none = await withServices(runOkfit(["verify"], { cwd, env }));
			assert.strictEqual(none.exitCode, 64);
			assert.match(
				none.stderr,
				/needs a concept id, --all, or --type <Type> \(run in a terminal to pick interactively\)/,
			);

			// An agent audience never gets a picker either: same 64, same hint.
			const agent = await withServices(runOkfit(["verify", "--agent"], { cwd, env }));
			assert.strictEqual(agent.exitCode, 64);
			assert.match(agent.stderr, /run in a terminal to pick interactively/);

			// Final-review F1: the JSON error envelope's `exit_code` must match
			// the process's own exit -- `VerifySelectionError` carries
			// `[Runtime.errorExitCode] = 64`.
			const noneJson = await withServices(runOkfit(["verify", "--format", "json"], { cwd, env }));
			assert.strictEqual(noneJson.exitCode, 64);
			const errorEnvelope = JSON.parse(noneJson.stdout) as { readonly exit_code: number };
			assert.strictEqual(errorEnvelope.exit_code, 64);

			// `id-and-batch`: an id is meaningless in batch mode.
			const both = await withServices(runOkfit(["verify", "project", "--all"], { cwd, env }));
			assert.strictEqual(both.exitCode, 64);

			// `okfit init` always scaffolds `project.md` as `status: draft`
			// (`packages/engine/src/init/scaffold.ts`), and `runVerifyBatch`
			// skips a draft candidate unconditionally, even one named by an
			// explicit `--type` -- there is no bypass (`packages/engine/src/verify/run.ts`).
			// Mark it stable first so this case actually exercises `--type`
			// narrowing a batch down to a verifiable candidate.
			const projectPath = join(cwd, "okf", "project.md");
			await writeFile(
				projectPath,
				(await readFile(projectPath, "utf8")).replace("status: draft\n", "status: stable\n"),
				"utf8",
			);

			const typed = await withServices(runOkfit(["verify", "--type", "Project", "--dry-run"], { cwd, env }));
			assert.strictEqual(typed.exitCode, 0);
			assert.match(typed.stdout, /would verify project by human:ada/);
			const unknown = await withServices(runOkfit(["verify", "--type", "Nope"], { cwd, env }));
			assert.strictEqual(unknown.exitCode, 64);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--all takes its project root from --root even from a different cwd", async () => {
		const { sandbox, cwd, env } = await seeded();
		const elsewhere = await makeSandbox("okfit-verify-elsewhere-");
		try {
			// Run from a cwd unrelated to the bundle; --root names the project.
			const run = await withServices(
				runOkfit(["verify", "--all", "--dry-run", "--root", cwd], { cwd: elsewhere.cwd, env }),
			);
			assert.strictEqual(run.exitCode, 0);
		} finally {
			await removeSandbox(sandbox);
			await removeSandbox(elsewhere);
		}
	});

	describe("--stable / --draft (#185)", () => {
		const NOW = { OKFIT_NOW: "2026-09-07T00:00:00.000Z" };

		it("--stable settles status and attests in one write", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const before = await readProject(cwd);
				const content = await digestOf(cwd, "project");
				const run = await withServices(runOkfit(["verify", "project", "--stable"], { cwd, env: { ...env, ...NOW } }));
				assert.strictEqual(run.exitCode, 0);
				assert.strictEqual(
					run.stdout,
					"verified project by human:ada at 2026-09-07T00:00:00Z; status draft -> stable\n",
				);
				assert.strictEqual(
					await readProject(cwd),
					before.replace(
						"status: draft\n",
						`status: stable\nverified:\n  - by: human:ada\n    at: 2026-09-07T00:00:00Z\n${binding(content)}`,
					),
				);
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("--stable --draft exits 64 and writes nothing", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const before = await readProject(cwd);
				const run = await withServices(
					runOkfit(["verify", "project", "--stable", "--draft"], { cwd, env: { ...env, ...NOW } }),
				);
				assert.strictEqual(run.exitCode, 64);
				assert.strictEqual(await readProject(cwd), before);
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("a status flag with --all or --type exits 64", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const before = await readProject(cwd);
				const all = await withServices(runOkfit(["verify", "--all", "--stable"], { cwd, env: { ...env, ...NOW } }));
				assert.strictEqual(all.exitCode, 64);
				const typed = await withServices(
					runOkfit(["verify", "--type", "Project", "--draft"], { cwd, env: { ...env, ...NOW } }),
				);
				assert.strictEqual(typed.exitCode, 64);
				assert.strictEqual(await readProject(cwd), before);
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("a status flag with no concept id exits 64 naming the id requirement, never opening the picker (#217)", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const before = await readProject(cwd);
				const bare = await withServices(runOkfit(["verify", "--stable"], { cwd, env: { ...env, ...NOW } }));
				assert.strictEqual(bare.exitCode, 64);
				assert.include(bare.stderr, "--stable and --draft need targets that name exactly one concept");
				assert.strictEqual(await readProject(cwd), before);
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("--dry-run prints would set status: and writes nothing", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const before = await readProject(cwd);
				const run = await withServices(
					runOkfit(["verify", "project", "--stable", "--dry-run"], { cwd, env: { ...env, ...NOW } }),
				);
				assert.strictEqual(run.exitCode, 0);
				assert.isTrue(run.stdout.includes("would set status:"));
				assert.strictEqual(await readProject(cwd), before);
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("--format json carries the status transition, and null without a flag", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const withFlag = await withServices(
					runOkfit(["verify", "project", "--stable", "--format", "json"], { cwd, env: { ...env, ...NOW } }),
				);
				assert.strictEqual(withFlag.exitCode, 0);
				assert.deepStrictEqual(JSON.parse(withFlag.stdout).status, { from: "draft", to: "stable" });
				const without = await withServices(
					runOkfit(["verify", "project", "--format", "json"], { cwd, env: { ...env, ...NOW } }),
				);
				assert.strictEqual(without.exitCode, 0);
				assert.strictEqual(JSON.parse(without.stdout).status, null);
			} finally {
				await removeSandbox(sandbox);
			}
		});
	});
	describe("--revoke", () => {
		const NOW = { OKFIT_NOW: "2026-09-07T00:00:00.000Z" };

		it("removes your entry and the binding, restoring the pre-verify bytes", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const before = await readProject(cwd);
				await withServices(runOkfit(["verify", "project"], { cwd, env: { ...env, ...NOW } }));

				const dry = await withServices(runOkfit(["verify", "project", "--revoke", "--dry-run"], { cwd, env }));
				assert.strictEqual(dry.exitCode, 0);
				assert.match(dry.stdout, /would revoke 1 verified entry of project by human:ada \(dry run, nothing written\)/);
				assert.notStrictEqual(await readProject(cwd), before);

				const run = await withServices(runOkfit(["verify", "project", "--revoke", "--format", "json"], { cwd, env }));
				assert.strictEqual(run.exitCode, 0);
				const envelope = JSON.parse(run.stdout) as Record<string, unknown>;
				assert.deepStrictEqual(envelope.removed, ["2026-09-07T00:00:00Z"]);
				assert.strictEqual(envelope.binding_cleared, true);
				assert.strictEqual(envelope.revoked_by, "human:ada");
				assert.strictEqual(await readProject(cwd), before);

				const again = await withServices(runOkfit(["verify", "project", "--revoke"], { cwd, env }));
				assert.strictEqual(again.exitCode, 3);
				// one line, no class name (#511)
				assert.strictEqual(again.stderr, 'error: "project" has no verified entry by human:ada to revoke\n');
			} finally {
				await removeSandbox(sandbox);
			}
		});

		it("is a usage error (64) without an id or beside --all, --type, --stable, --draft or --at", async () => {
			const { sandbox, cwd, env } = await seeded();
			try {
				const noId = await withServices(runOkfit(["verify", "--revoke"], { cwd, env }));
				assert.strictEqual(noId.exitCode, 64);
				assert.match(noId.stderr, /--revoke needs at least one concept target/);
				for (const flag of [
					["--all"],
					["--type", "Decision"],
					["--stable"],
					["--draft"],
					["--at", "2026-09-07T00:00:00Z"],
				]) {
					const run = await withServices(runOkfit(["verify", "project", "--revoke", ...flag], { cwd, env }));
					assert.strictEqual(run.exitCode, 64, flag.join(" "));
					assert.match(run.stderr, new RegExp(`cannot combine with ${flag[0]}`));
				}
			} finally {
				await removeSandbox(sandbox);
			}
		});
	});

	const allowOnly = (cwd: string, humans: string): Promise<void> =>
		appendFile(join(cwd, ".config", "okfit.toml"), `\n[actors]\nhumans = ${humans}\n`, "utf8");

	it("refuses an unlisted human with exit 3 and writes nothing (allow-list)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await allowOnly(cwd, '["human:grace"]');
			const before = await readProject(cwd);
			const run = await withServices(runOkfit(["verify", "project"], { cwd, env }));
			assert.strictEqual(run.exitCode, 3);
			assert.include(run.stderr, "HumanActorNotAllowedError");
			assert.include(run.stderr, "human:ada is not in [actors].humans");
			assert.include(run.stderr, "git config --global okfit.actor human:<id>");
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("refuses an unlisted human's --revoke before touching the file", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const first = await withServices(runOkfit(["verify", "project"], { cwd, env }));
			assert.strictEqual(first.exitCode, 0);
			await allowOnly(cwd, '["human:grace"]');
			const before = await readProject(cwd);
			const run = await withServices(runOkfit(["verify", "--revoke", "project"], { cwd, env }));
			assert.strictEqual(run.exitCode, 3);
			assert.include(run.stderr, "HumanActorNotAllowedError");
			assert.strictEqual(await readProject(cwd), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("verifies as git config okfit.actor when it matches a glob entry", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const home = sandbox.env.HOME ?? "";
			await appendFile(join(home, ".gitconfig"), "[okfit]\n\tactor = human:grace-h\n", "utf8");
			await allowOnly(cwd, '["human:grace*"]');
			const run = await withServices(runOkfit(["verify", "project"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const after = await readProject(cwd);
			assert.include(after, "by: human:grace-h");
			assert.notInclude(after, "@");
		} finally {
			await removeSandbox(sandbox);
		}
	});
});

describe("okfit verify on a status outside the vocabulary (e2e, OKF 0.3 5.4, R7/R11)", () => {
	const margin = (cwd: string): string => join(cwd, "okf", "metrics", "margin.md");

	/** The `unknown-status` seed (`status: bogus` on metrics/margin) with the ada identity and the seed's own config kept. */
	const seededUnknown = async () => {
		const sandbox = await makeSandbox("okfit-verify-unknown-");
		const home = sandbox.env.HOME;
		if (home === undefined) throw new Error("expected a HOME in the sandbox env");
		await writeFile(join(home, ".gitconfig"), "[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n", "utf8");
		await writeSeedInto(sandbox.cwd, ERROR_PROJECTS["unknown-status"]);
		await appendFile(join(sandbox.cwd, ".config", "okfit.toml"), '\n[actors]\nhumans = ["human:ada"]\n', "utf8");
		return { sandbox, cwd: sandbox.cwd, env: baseEnv(sandbox.env) };
	};

	it("exits 3 naming bogus and writes nothing", async () => {
		const { sandbox, cwd, env } = await seededUnknown();
		try {
			const before = await readFile(margin(cwd), "utf8");
			const run = await withServices(runOkfit(["verify", "metrics/margin"], { cwd, env }));
			assert.strictEqual(run.exitCode, 3, run.stderr);
			assert.include(
				run.stderr,
				'error: "metrics/margin" has status "bogus", which is not draft, stable or deprecated',
			);
			assert.include(run.stderr, "--stable or --draft");
			assert.strictEqual(await readFile(margin(cwd), "utf8"), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	const LINE =
		'skipped decisions/wip: status "wip" is not draft, stable or deprecated, so it cannot be verified; set its status in the frontmatter, or verify it on its own with okfit verify decisions/wip --stable or --draft\n';

	it("an id list skips an unknown status with a line whose command works, and verifies the rest (#507)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const wip = join(cwd, "okf", "decisions", "wip.md");
			await writeFile(
				wip,
				"---\ntype: Decision\ntitle: Wip\ndescription: A decision.\nstatus: wip\n---\n\n# Wip\n",
				"utf8",
			);
			const wipBefore = await readFile(wip, "utf8");
			const run = await withServices(runOkfit(["verify", "decisions/wip", "decisions/b"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0, run.stderr);
			assert.include(run.stdout, LINE);
			assert.include(run.stdout, "verified decisions/b by human:ada");
			assert.include(run.stdout, "verified 1, skipped 1");
			assert.strictEqual(await readFile(wip, "utf8"), wipBefore);
			assert.include(await readFile(join(cwd, "okf", "decisions", "b.md"), "utf8"), "by: human:ada");
			// the line's suggested command is accepted and works
			const suggested = await withServices(
				runOkfit(["verify", "decisions/wip", "--stable", "--dry-run", "--no-diff"], { cwd, env }),
			);
			assert.strictEqual(suggested.exitCode, 0, suggested.stderr);
			assert.strictEqual(await readFile(wip, "utf8"), wipBefore);
			// control: a missing id still fails the whole list at target resolution (the all-unknown list is the next test)
			const all = await withServices(runOkfit(["verify", "decisions/wip", "decisions/wip2"], { cwd, env }));
			assert.notStrictEqual(all.exitCode, 0);
			// JSON keeps { id, reason }
			const json = await withServices(
				runOkfit(["verify", "decisions/wip", "decisions/a", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(json.exitCode, 0, json.stderr);
			assert.deepStrictEqual(JSON.parse(json.stdout).skipped, [{ id: "decisions/wip", reason: "unknown-status" }]);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("the single-id unknown-status refusal prints the status as the skip line does (#511)", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeTwoDecisions(cwd);
			const c = join(cwd, "okf", "decisions", "c.md");
			// YAML double-quoted escapes: an SGR sequence, a BEL, a CR and an LF that would forge a second line
			await writeFile(
				c,
				'---\ntype: Decision\ntitle: C\ndescription: A decision.\nstatus: "w\\e[31mip\\a\\rX\\nerror: forged"\n---\n\n# C\n',
				"utf8",
			);
			const run = await withServices(runOkfit(["verify", "decisions/c"], { cwd, env }));
			assert.strictEqual(run.exitCode, 3, run.stderr);
			const lines = run.stderr.split("\n").filter((line) => line !== "");
			assert.strictEqual(lines.length, 1, run.stderr);
			assert.isTrue(lines[0]?.startsWith('error: "decisions/c" has status "wip X error: forged"'), run.stderr);
			for (const control of ["\u001b", "\u0007", "\r"]) assert.notInclude(run.stderr, control);
			// the batch skip line, through Doc, gives the same text
			const list = await withServices(
				runOkfit(["verify", "decisions/c", "decisions/a", "--dry-run", "--no-diff"], { cwd, env }),
			);
			assert.strictEqual(list.exitCode, 0, list.stderr);
			assert.include(
				list.stdout,
				'skipped decisions/c: status "wip X error: forged" is not draft, stable or deprecated',
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("an id list of only unknown statuses writes nothing and exits 0 (#507)", async () => {
		const { sandbox, cwd, env } = await seededUnknown();
		try {
			const before = await readFile(margin(cwd), "utf8");
			await writeFile(
				join(cwd, "okf", "metrics", "other.md"),
				before.replace("margin", "other").replace("Margin", "Other"),
				"utf8",
			);
			const run = await withServices(runOkfit(["verify", "metrics/margin", "metrics/other"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0, run.stderr);
			assert.include(run.stdout, 'skipped metrics/margin: status "bogus" is not draft, stable or deprecated');
			assert.include(run.stdout, "verified 0, skipped 2");
			assert.strictEqual(await readFile(margin(cwd), "utf8"), before);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--stable (control) exits 0 and the JSON reports the raw status it replaced", async () => {
		const { sandbox, cwd, env } = await seededUnknown();
		try {
			const run = await withServices(
				runOkfit(["verify", "metrics/margin", "--stable", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(run.exitCode, 0, run.stderr);
			assert.deepStrictEqual(JSON.parse(run.stdout).status, { from: "bogus", to: "stable" });
			const text = await readFile(margin(cwd), "utf8");
			assert.include(text, "status: stable\n");
			assert.notInclude(text, "bogus");
		} finally {
			await removeSandbox(sandbox);
		}
	});
	it("the future-stamp advice leads to a verification when the body has an uncommitted change (#515)", async () => {
		const { sandbox, cwd, env, file } = await seededFutureStamp();
		try {
			await appendFile(file, "\nAn edit that is not committed yet.\n", "utf8");

			const refused = await withServices(runOkfit(["verify", "decisions/a"], { cwd, env }));
			assert.strictEqual(refused.exitCode, 3);
			assert.include(
				refused.stderr,
				"Commit any change to its body, then run okfit sync, which re-stamps it, then verify again",
			);

			// the premise: sync skips a body change that is not committed, and the stamp stays in the future
			const skipped = await withServices(runOkfit(["sync", "--only", "generated"], { cwd, env }));
			assert.strictEqual(skipped.exitCode, 0, skipped.stderr);
			assert.include(skipped.stdout, "skipped decisions/a: has uncommitted changes");
			assert.include(await readFile(file, "utf8"), "at: 2099-01-01T00:00:00Z");

			// the advice's own order: commit, then sync, then verify
			await commit(cwd, { message: "edit body", authoredAt: "2026-10-01T00:00:00+00:00" }, env);
			const synced = await withServices(runOkfit(["sync", "--only", "generated"], { cwd, env }));
			assert.strictEqual(synced.exitCode, 0, synced.stderr);
			assert.include(synced.stdout, "wrote decisions/a");
			const verified = await withServices(runOkfit(["verify", "decisions/a", "--dry-run", "--no-diff"], { cwd, env }));
			assert.strictEqual(verified.exitCode, 0, verified.stderr);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("the future-stamp advice with no body change: okfit sync alone re-stamps it (#515)", async () => {
		const { sandbox, cwd, env, file } = await seededFutureStamp();
		try {
			const refused = await withServices(runOkfit(["verify", "decisions/a"], { cwd, env }));
			assert.strictEqual(refused.exitCode, 3);
			assert.include(refused.stderr, "Commit any change to its body, then run okfit sync, which re-stamps it");

			const synced = await withServices(runOkfit(["sync", "--only", "generated"], { cwd, env }));
			assert.strictEqual(synced.exitCode, 0, synced.stderr);
			assert.include(synced.stdout, "wrote decisions/a");
			assert.notInclude(await readFile(file, "utf8"), "2099");
			const verified = await withServices(runOkfit(["verify", "decisions/a", "--dry-run", "--no-diff"], { cwd, env }));
			assert.strictEqual(verified.exitCode, 0, verified.stderr);
		} finally {
			await removeSandbox(sandbox);
		}
	});
});
