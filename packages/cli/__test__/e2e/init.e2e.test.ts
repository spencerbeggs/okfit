import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const withServices = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

const baseEnv = (env: Readonly<Record<string, string>>): Record<string, string> => ({
	...env,
	PATH: process.env.PATH ?? "",
	NO_COLOR: "1",
});

const DIRECTORIES = [
	["modules", "Modules"],
	["decisions", "Decisions"],
	["conventions", "Conventions"],
	["interfaces", "Interfaces"],
	["references", "References"],
] as const;

describe("okfit init", () => {
	// (checked) OKFIT_NOW added and log.md/index.md content assertions added below
	// so this test actually proves "the §3.4 file list and contents" (contract
	// §6.2's init-fresh.e2e.test.ts row) for all nine scaffolded files, not just
	// project.md/config.toml/the five per-directory indexes.
	it("scaffolds a fresh directory with exact contents, exits 0, and a follow-up validate also exits 0 (K-29)", async () => {
		const { cwd, env } = await makeSandbox();
		const title = basename(cwd);

		const init = await withServices(
			runOkfit(["init"], { cwd, env: { ...baseEnv(env), OKFIT_NOW: "2026-09-05T00:00:00.000Z" } }),
		);
		assert.strictEqual(init.exitCode, 0);
		assert.strictEqual(init.stdout, "Initialized okf with the software-project profile\n");
		assert.strictEqual(init.stderr, "0 errors, 0 warnings, 0 info in 1 concepts (okf)\n");

		const project = await readFile(`${cwd}/okf/project.md`, "utf8");
		assert.strictEqual(
			project,
			[
				"---",
				"type: Project",
				`title: ${title}`,
				"description: What this project is, its boundaries, and its non-goals.",
				"status: draft",
				"---",
				"",
				`# ${title}`,
				"",
				"## Purpose",
				"",
				"Describe what this project is for in one paragraph.",
				"",
				"## Boundaries",
				"",
				"Describe what this project owns and what it deliberately leaves to others.",
				"",
				"## Non-goals",
				"",
				"List what this project will not do, so a reader never infers it from silence.",
				"",
			].join("\n"),
		);

		const config = await readFile(`${cwd}/.config/okfit.toml`, "utf8");
		assert.include(config, 'path = "okf"');
		assert.include(config, 'profile = "software-project"');

		for (const [directory, heading] of DIRECTORIES) {
			const contents = await readFile(`${cwd}/okf/${directory}/index.md`, "utf8");
			assert.strictEqual(contents, `# ${heading}\n`);
		}

		const log = await readFile(`${cwd}/okf/log.md`, "utf8");
		assert.strictEqual(log, "## 2026-09-05\n\n* Initialized the bundle with the software-project profile\n");

		const index = await readFile(`${cwd}/okf/index.md`, "utf8");
		assert.strictEqual(
			index,
			[
				"---",
				'okf_version: "0.2"',
				"---",
				"",
				"# Project",
				"",
				`* [${title}](project.md) - What this project is, its boundaries, and its non-goals.`,
				"",
				"# Subdirectories",
				"",
				"* [conventions](conventions/index.md)",
				"* [decisions](decisions/index.md)",
				"* [interfaces](interfaces/index.md)",
				"* [modules](modules/index.md)",
				"* [references](references/index.md)",
				"",
			].join("\n"),
		);

		const validate = await withServices(runOkfit(["validate"], { cwd, env: baseEnv(env) }));
		assert.strictEqual(validate.exitCode, 0);
		assert.strictEqual(validate.stdout, "");
		assert.strictEqual(validate.stderr, "0 errors, 0 warnings, 0 info in 1 concepts (okf)\n");
	});

	it("refuses to overwrite an already-initialised bundle, all-or-nothing (K-28)", async () => {
		const { cwd, env } = await makeSandbox();
		const first = await withServices(runOkfit(["init"], { cwd, env: baseEnv(env) }));
		assert.strictEqual(first.exitCode, 0);

		const before = await readFile(`${cwd}/okf/project.md`, "utf8");

		const second = await withServices(runOkfit(["init"], { cwd, env: baseEnv(env) }));
		assert.strictEqual(second.exitCode, 3);
		assert.strictEqual(second.stdout, "");
		assert.strictEqual(
			second.stderr,
			[
				"error: refusing to overwrite existing files:",
				"  .config/okfit.toml",
				"  okf/index.md",
				"  okf/log.md",
				"  okf/project.md",
				"  okf/modules/index.md",
				"  okf/decisions/index.md",
				"  okf/conventions/index.md",
				"  okf/interfaces/index.md",
				"  okf/references/index.md",
				"Nothing was written.",
				"",
			].join("\n"),
		);

		const after = await readFile(`${cwd}/okf/project.md`, "utf8");
		assert.strictEqual(after, before);
	});

	it("--profile none skips profile config but still scaffolds and validates clean (decision 2, decision 3)", async () => {
		const { cwd, env } = await makeSandbox();
		const result = await withServices(runOkfit(["init", "--profile", "none"], { cwd, env: baseEnv(env) }));
		assert.strictEqual(result.exitCode, 0);
		assert.strictEqual(result.stdout, "Initialized okf with the none profile\n");
		assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 1 concepts (okf)\n");

		for (const [directory] of DIRECTORIES) {
			const contents = await readFile(`${cwd}/okf/${directory}/index.md`, "utf8");
			assert.isTrue(contents.startsWith("# "));
		}

		const config = await readFile(`${cwd}/.config/okfit.toml`, "utf8");
		assert.include(config, 'profile = "none"');
	});

	it("an unknown --profile name warns on stderr and still scaffolds and validates clean (K-4, decision 2, decision 3)", async () => {
		const { cwd, env } = await makeSandbox();
		const result = await withServices(runOkfit(["init", "--profile", "bogus"], { cwd, env: baseEnv(env) }));
		assert.strictEqual(result.exitCode, 0);
		assert.strictEqual(result.stdout, "Initialized okf with the bogus profile\n");
		assert.strictEqual(
			result.stderr,
			[
				'warning: unknown profile "bogus"; continuing with defaults',
				"0 errors, 0 warnings, 0 info in 1 concepts (okf)",
				"",
			].join("\n"),
		);

		const config = await readFile(`${cwd}/.config/okfit.toml`, "utf8");
		assert.include(config, 'profile = "bogus"');
	});

	it("writes .config/okfit.toml whose first line is the #:schema directive", async () => {
		const { cwd, env } = await makeSandbox();
		const result = await withServices(runOkfit(["init"], { cwd, env: baseEnv(env) }));
		assert.strictEqual(result.exitCode, 0);
		const config = await readFile(`${cwd}/.config/okfit.toml`, "utf8");
		assert.strictEqual(
			config.split("\n")[0],
			"#:schema https://raw.githubusercontent.com/spencerbeggs/okfit/main/schemas/config/okfit-1.0.0.json",
		);
	});

	it("writes a blank line between the directive and the first table", async () => {
		const { cwd, env } = await makeSandbox();
		await withServices(runOkfit(["init"], { cwd, env: baseEnv(env) }));
		const config = await readFile(`${cwd}/.config/okfit.toml`, "utf8");
		assert.strictEqual(config.split("\n")[1], "");
		assert.strictEqual(config.split("\n")[2], "[bundle]");
	});

	it("refuses when .okfit.toml already exists, naming it in the error", async () => {
		const { cwd, env } = await makeSandbox();
		await writeFile(`${cwd}/.okfit.toml`, 'bundle.path = "okf"\n', "utf8");
		const result = await withServices(runOkfit(["init"], { cwd, env: baseEnv(env) }));
		assert.strictEqual(result.exitCode, 3);
		assert.strictEqual(result.stdout, "");
		assert.strictEqual(
			result.stderr,
			`${["error: refusing to overwrite existing files:", "  .okfit.toml", "Nothing was written."].join("\n")}\n`,
		);
	});

	it("names every colliding project-level config in one InitOverwriteError", async () => {
		const { cwd, env } = await makeSandbox();
		await writeFile(`${cwd}/.okfit.toml`, 'bundle.path = "okf"\n', "utf8");
		await writeFile(`${cwd}/okfit.toml`, 'bundle.path = "okf"\n', "utf8");
		const result = await withServices(runOkfit(["init"], { cwd, env: baseEnv(env) }));
		assert.strictEqual(result.exitCode, 3);
		assert.strictEqual(
			result.stderr,
			`${["error: refusing to overwrite existing files:", "  .okfit.toml", "  okfit.toml", "Nothing was written."].join(
				"\n",
			)}\n`,
		);
	});
});
