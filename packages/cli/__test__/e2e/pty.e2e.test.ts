// pty end-to-end suite (#231): the interactive Ink screens driven through a
// real pseudo-terminal by the system `script`, plus a no-pty proof that the
// non-interactive path never resolves `ink` or `react`.

import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import type { Sandbox } from "./utils/fixtures.js";
import { copyFixtureInto, makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { BIN } from "./utils/okfit.js";
import { KEYS, ptyAvailable, runPty } from "./utils/pty.js";
import { commit, initRepo } from "./utils/repo.js";

const execFileAsync = promisify(execFile);
const TRACER = resolve(import.meta.dirname, "utils", "resolve-tracer.mjs");
const CLI_ROOT = resolve(import.meta.dirname, "..", "..");
const CLEAN_FIXTURE = resolve(CLI_ROOT, "..", "profiles", "__test__", "fixtures", "software-project");
const TIMEOUT = 60_000;

/** The sandbox env plus a hermetic git identity (the verify actor comes from git). */
const ptyEnv = (sandbox: Sandbox): Record<string, string> => ({
	...sandbox.env,
	GIT_CONFIG_GLOBAL: join(sandbox.env.HOME ?? "", ".gitconfig"),
	GIT_CONFIG_NOSYSTEM: "1",
	OKFIT_NOW: "2026-10-09T12:00:00Z",
});

const writeIdentity = (sandbox: Sandbox) =>
	writeFile(
		join(sandbox.env.HOME ?? "", ".gitconfig"),
		"[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n[commit]\n\tgpgsign = false\n",
		"utf8",
	);

const decision = (title: string): string =>
	`---\ntype: Decision\ntitle: ${title}\ndescription: ${title}.\n---\n\n# ${title}\n`;

const exists = (path: string): Promise<boolean> =>
	access(path).then(
		() => true,
		() => false,
	);

/** An `okfit init`-scaffolded project with two unattested Decisions (require_verified). */
const verifyFixture = async (): Promise<{ sandbox: Sandbox; env: Record<string, string>; files: string[] }> => {
	const sandbox = await makeSandbox("okfit-pty-");
	await writeIdentity(sandbox);
	const env = ptyEnv(sandbox);
	const scaffold = await runPty(["init", "--human"], {
		cwd: sandbox.cwd,
		env,
		steps: [
			{ waitFor: "Bundle directory", send: KEYS.enter },
			{ waitFor: "Config file location", send: KEYS.enter },
		],
	});
	assert.strictEqual(scaffold.exitCode, 0, scaffold.output);
	const files = [join(sandbox.cwd, "okf", "decisions", "a.md"), join(sandbox.cwd, "okf", "decisions", "b.md")];
	await writeFile(files[0] as string, decision("Alpha"), "utf8");
	await writeFile(files[1] as string, decision("Beta"), "utf8");
	return { sandbox, env, files };
};

describe("no ink or react on the non-interactive path (#231)", () => {
	it(
		"--help resolves neither ink nor react",
		async () => {
			const dir = await mkdtemp(join(tmpdir(), "okfit-trace-"));
			const trace = join(dir, "trace.txt");
			try {
				await execFileAsync(process.execPath, ["--import", TRACER, BIN, "--help"], {
					env: { ...process.env, OKFIT_TRACE_FILE: trace },
				});
				const specifiers = (await readFile(trace, "utf8")).split("\n").filter((line) => line !== "");
				assert.ok(specifiers.length > 0, "the tracer recorded nothing");
				const offenders = specifiers.filter((s) => /^(ink|react)(\/|$)/.test(s));
				assert.deepStrictEqual(offenders, []);
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
		TIMEOUT,
	);

	it(
		"positive control: the tracer lists ink when ink is imported",
		async () => {
			const dir = await mkdtemp(join(tmpdir(), "okfit-trace-"));
			const trace = join(dir, "trace.txt");
			try {
				await execFileAsync(
					process.execPath,
					["--import", TRACER, "--input-type=module", "-e", 'await import("ink")'],
					{
						cwd: CLI_ROOT,
						env: { ...process.env, OKFIT_TRACE_FILE: trace },
					},
				);
				const specifiers = (await readFile(trace, "utf8")).split("\n");
				assert.ok(specifiers.includes("ink"), "the tracer missed an import of ink");
			} finally {
				await rm(dir, { recursive: true, force: true });
			}
		},
		TIMEOUT,
	);

	it.skipIf(!ptyAvailable)(
		"positive control: an interactive picker run DOES resolve ink (so the --help proof is not vacuous)",
		async () => {
			const { sandbox, env } = await verifyFixture();
			// Inside the sandbox root, so removeSandbox cleans it up.
			const trace = join(dirname(sandbox.cwd), "trace.txt");
			try {
				const run = await runPty(["verify", "--human", "--dry-run"], {
					cwd: sandbox.cwd,
					env: { ...env, OKFIT_TRACE_FILE: trace },
					nodeArgs: ["--import", TRACER],
					steps: [{ waitFor: "Attest which concepts?", send: KEYS.esc }],
				});
				assert.strictEqual(run.exitCode, 130, run.output);
				const specifiers = (await readFile(trace, "utf8")).split("\n");
				assert.ok(
					specifiers.some((s) => s === "ink" || s.startsWith("ink/")),
					"an interactive run never resolved ink",
				);
			} finally {
				await removeSandbox(sandbox);
			}
		},
		TIMEOUT,
	);
});

describe.skipIf(!ptyAvailable)("interactive screens under a pty (#231)", () => {
	it(
		"verify picker: Space, Enter, Enter attests (dry run); Esc cancels with 130 and writes nothing",
		async () => {
			const { sandbox, env, files } = await verifyFixture();
			try {
				const before = await Promise.all(files.map((f) => readFile(f, "utf8")));
				const ok = await runPty(["verify", "--human", "--dry-run"], {
					cwd: sandbox.cwd,
					env,
					steps: [
						{ waitFor: "Attest which concepts?", send: KEYS.space },
						{ waitFor: /◉ decisions\/a/, send: KEYS.enter },
						{ waitFor: /Attest 1 concept\(s\) as human:ada\?/, send: KEYS.enter },
					],
				});
				assert.strictEqual(ok.exitCode, 0, ok.output);
				assert.match(ok.output, /^Decision$/m);
				assert.match(ok.output, /would verify decisions\/a by human:ada/);
				assert.match(ok.output, /dry run, nothing written/);

				const cancelled = await runPty(["verify", "--human", "--dry-run"], {
					cwd: sandbox.cwd,
					env,
					steps: [{ waitFor: "Attest which concepts?", send: KEYS.esc }],
				});
				assert.strictEqual(cancelled.exitCode, 130, cancelled.output);
				assert.match(cancelled.output, /cancelled; nothing written/);
				assert.deepStrictEqual(await Promise.all(files.map((f) => readFile(f, "utf8"))), before);
			} finally {
				await removeSandbox(sandbox);
			}
		},
		TIMEOUT,
	);

	it(
		"init wizard: Enter through both screens writes the default config; Esc on screen 2 writes none",
		async () => {
			// One registered profile means no profile screen: the wizard asks for the bundle directory and the config location.
			const sandbox = await makeSandbox("okfit-pty-init-");
			try {
				const env = ptyEnv(sandbox);
				const cancelled = await runPty(["init", "--human"], {
					cwd: sandbox.cwd,
					env,
					steps: [
						{ waitFor: "Bundle directory", send: KEYS.enter },
						{ waitFor: "Config file location", send: KEYS.esc },
					],
				});
				assert.strictEqual(cancelled.exitCode, 130, cancelled.output);
				assert.match(cancelled.output, /cancelled; nothing written/);
				assert.ok(!(await exists(join(sandbox.cwd, ".config", "okfit.toml"))));
				assert.ok(!(await exists(join(sandbox.cwd, "okf"))));

				const ok = await runPty(["init", "--human"], {
					cwd: sandbox.cwd,
					env,
					steps: [
						{ waitFor: "Bundle directory", send: KEYS.enter },
						{ waitFor: "Config file location", send: KEYS.enter },
					],
				});
				assert.strictEqual(ok.exitCode, 0, ok.output);
				assert.ok(await exists(join(sandbox.cwd, ".config", "okfit.toml")));
				assert.ok(await exists(join(sandbox.cwd, "okf", "project.md")));
			} finally {
				await removeSandbox(sandbox);
			}
		},
		TIMEOUT,
	);

	it(
		"0x0 pty: the picker falls back to 80x24 and renders unwrapped; Esc exits 130",
		async () => {
			const { sandbox, env } = await verifyFixture();
			try {
				const run = await runPty(["verify", "--human", "--dry-run"], {
					cwd: sandbox.cwd,
					env,
					cols: 0,
					rows: 0,
					steps: [{ waitFor: "Attest which concepts?", send: KEYS.esc }],
				});
				assert.strictEqual(run.exitCode, 130, run.output);
				assert.match(run.output, /^→ ◯ decisions\/a {2}stable$/m);
				assert.match(run.output, /^↑\/↓ move · space toggle · a toggle section · enter continue · q\/esc cancel$/m);
				assert.match(run.output, /cancelled; nothing written/);
			} finally {
				await removeSandbox(sandbox);
			}
		},
		TIMEOUT,
	);

	it(
		"stale --verify: the picker lists the stale concept; Esc exits 130",
		async () => {
			const sandbox = await makeSandbox("okfit-pty-stale-");
			try {
				await writeIdentity(sandbox);
				await copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd);
				const concept = join(sandbox.cwd, "okf", "modules", "core.md");
				const original = await readFile(concept, "utf8");
				const stamped = original.replace(
					"tags: [architecture]\n---",
					"tags: [architecture]\nstale_after: 2025-01-01T00:00:00Z\n---",
				);
				assert.notStrictEqual(stamped, original);
				await writeFile(concept, stamped, "utf8");
				const run = await runPty(["stale", "--verify", "--human", "--dry-run"], {
					cwd: sandbox.cwd,
					env: ptyEnv(sandbox),
					steps: [{ waitFor: "Re-verify which stale concepts?", send: KEYS.esc }],
				});
				assert.strictEqual(run.exitCode, 130, run.output);
				assert.match(run.output, /modules\/core/);
				assert.match(run.output, /cancelled; nothing written/);
				assert.strictEqual(await readFile(concept, "utf8"), stamped);
			} finally {
				await removeSandbox(sandbox);
			}
		},
		TIMEOUT,
	);

	it(
		"sync confirm: Esc cancels with 130 and writes nothing; Enter writes the files",
		async () => {
			const sandbox = await makeSandbox("okfit-pty-sync-");
			try {
				await writeIdentity(sandbox);
				const env = ptyEnv(sandbox);
				await initRepo(sandbox.cwd, env);
				await runPty(["init", "--human"], {
					cwd: sandbox.cwd,
					env,
					steps: [
						{ waitFor: "Bundle directory", send: KEYS.enter },
						{ waitFor: "Config file location", send: KEYS.enter },
					],
				});
				await commit(sandbox.cwd, { message: "okfit init", authoredAt: "2026-09-01T00:00:00+00:00" }, env);
				const decisionFile = join(sandbox.cwd, "okf", "decisions", "example.md");
				await writeFile(
					decisionFile,
					`---\ntype: Decision\ntitle: Example\ndescription: Example.\ngenerated:\n  by: human:ada\nstatus: draft\n---\n\n# Example\n`,
					"utf8",
				);
				await commit(sandbox.cwd, { message: "add decision", authoredAt: "2026-09-02T00:00:00+00:00" }, env);
				const indexFile = join(sandbox.cwd, "okf", "decisions", "index.md");
				const beforeDecision = await readFile(decisionFile, "utf8");
				const beforeIndex = await readFile(indexFile, "utf8");

				const cancelled = await runPty(["sync", "--human"], {
					cwd: sandbox.cwd,
					env,
					steps: [{ waitFor: /Write \d+ file\(s\)\?/, send: KEYS.esc }],
				});
				assert.strictEqual(cancelled.exitCode, 130, cancelled.output);
				assert.match(cancelled.output, /cancelled; nothing written/);
				assert.strictEqual(await readFile(decisionFile, "utf8"), beforeDecision);
				assert.strictEqual(await readFile(indexFile, "utf8"), beforeIndex);

				const ok = await runPty(["sync", "--human"], {
					cwd: sandbox.cwd,
					env,
					steps: [{ waitFor: /Write \d+ file\(s\)\?/, send: KEYS.enter }],
				});
				assert.strictEqual(ok.exitCode, 0, ok.output);
				assert.notStrictEqual(await readFile(decisionFile, "utf8"), beforeDecision);
				assert.notStrictEqual(await readFile(indexFile, "utf8"), beforeIndex);
			} finally {
				await removeSandbox(sandbox);
			}
		},
		TIMEOUT,
	);
});

describe("human report lines stay unwrapped on a narrow terminal", () => {
	it(
		"lint --human prints a long diagnostic on one physical line at 70 columns",
		async () => {
			const { sandbox, env, files } = await verifyFixture();
			try {
				await writeFile(
					files[0] as string,
					`---\ntype: Decision\ntitle: Alpha\n---\n\n[x](./does-not-exist-${"very-long-name-".repeat(6)}.md)\n`,
					"utf8",
				);
				const run = await runPty(["lint", "--human"], { cwd: sandbox.cwd, env, cols: 70 });
				const diagnostics = run.output.split("\n").filter((l) => /\b(error|warning|info) [a-z-]+ /.test(l));
				assert.ok(diagnostics.length > 0, run.output);
				const long = diagnostics.find((l) => l.length > 70);
				assert.ok(long !== undefined, `expected a diagnostic wider than 70 columns:\n${run.output}`);
			} finally {
				await removeSandbox(sandbox);
			}
		},
		TIMEOUT,
	);
});
