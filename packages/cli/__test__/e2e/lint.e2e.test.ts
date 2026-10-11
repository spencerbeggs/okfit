// Acceptance suite for `okfit lint` (issue #17): same handler skeleton as
// `okfit validate`, minus the conformance tier. Spawns the built dist/dev
// bin (K-43), never Command.run in-process, per this package's e2e
// convention.
//
// K-44: no CLI-owned fixtures. Reuses the same profiles/core fixtures
// validate.e2e.test.ts already names.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Sandbox } from "./utils/fixtures.js";
import { copyFixtureInto, makeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const CORE_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "core", "__test__", "fixtures");
const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");

const CLEAN_FIXTURE = join(PROFILES_FIXTURES, "software-project");
const LINT_BAD_FIXTURE = join(PROFILES_FIXTURES, "bad", "module-no-kind");
const CONFORMANCE_BAD_FIXTURE = join(CORE_FIXTURES, "bad", "c-frontmatter-missing");

const writeFileDeep = async (path: string, contents: string): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents, "utf8");
};

describe("okfit lint: clean bundle", () => {
	it.effect("exits 0, prints only the summary to stderr", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));

			const result = yield* runOkfit(["lint"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout, "");
			assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 18 concepts (okf)\n");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit lint: a lint error", () => {
	it.effect("exits 1 and the stdout line names the lint code", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(LINT_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["lint"], sandbox);

			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual(
				result.stdout,
				'modules/core.md:1:1 error required-key-missing Required key "kind" is missing\n',
			);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit lint: GitHub Actions annotations", () => {
	it.effect("--ci under GITHUB_ACTIONS adds a ::error annotation whose file is relative to GITHUB_WORKSPACE", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(LINT_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["lint", "--ci"], {
				cwd: sandbox.cwd,
				env: { ...sandbox.env, GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: sandbox.cwd },
			});

			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual(
				result.stdout,
				'modules/core.md:1:1 error required-key-missing Required key "kind" is missing\n::error file=okf/modules/core.md,line=1,col=1::required-key-missing Required key "kind" is missing\n',
			);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("a bundle outside GITHUB_WORKSPACE annotates without a file", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(LINT_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["lint", "--ci"], {
				cwd: sandbox.cwd,
				env: { ...sandbox.env, GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: join(sandbox.cwd, "okf", "modules") },
			});

			assert.include(result.stdout, '::error line=1,col=1::required-key-missing Required key "kind" is missing');
			assert.notInclude(result.stdout, "file=");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit lint: conformance errors never surface", () => {
	it.effect("a conformance-bad bundle still exits on its lint/profile tier alone, never exit 2", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CONFORMANCE_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["lint", "--format", "json"], sandbox);

			// This fixture's only diagnostic under `validate` besides the
			// conformance error is a profile "project-missing" error (no
			// project.md) -- `lint` still reports that (it drops ONLY
			// conformance), so exit 1, never validate's own exit 2.
			assert.strictEqual(result.exitCode, 1);
			const envelope = JSON.parse(result.stdout) as {
				readonly summary: { readonly conformance_errors: number };
				readonly diagnostics: ReadonlyArray<{ readonly source: string }>;
			};
			assert.strictEqual(envelope.summary.conformance_errors, 0);
			assert.isFalse(envelope.diagnostics.some((d) => d.source === "core.conformance"));
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit lint --format json", () => {
	it.effect("deep-equals an envelope whose summary.conformance_errors is always 0", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(LINT_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["lint", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual(result.stderr, "");
			const bundleRoot = join(sandbox.cwd, "okf");
			const {
				okfit_version: reportedVersion,
				engine_version: engineVersion,
				...envelope
			} = JSON.parse(result.stdout) as Record<string, unknown>;
			assert.match(String(reportedVersion), /^\d+\.\d+\.\d+/);
			assert.match(String(engineVersion), /^\d+\.\d+\.\d+/);
			assert.deepStrictEqual(envelope, {
				schema: 1,
				producer: "okfit",
				distribution: null,
				okf_version: "0.2",
				root: bundleRoot,
				profile: "software-project",
				exit_code: 1,
				summary: {
					conformance_errors: 0,
					lint_errors: 1,
					lint_warnings: 0,
					lint_info: 0,
					profile_errors: 0,
					concepts: 2,
				},
				diagnostics: [
					{
						source: "core.lint",
						file: "modules/core.md",
						code: "required-key-missing",
						severity: "error",
						message: 'Required key "kind" is missing',
						range: { offset: 0, length: 127, line: 0, character: 0 },
					},
				],
			});
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("exit 3 under json still gets the K-22 error envelope on stdout", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const missingConfig = join(sandbox.cwd, "does-not-exist.toml");

			const result = yield* runOkfit(["lint", "--format", "json", "--config", missingConfig], sandbox);

			assert.strictEqual(result.exitCode, 3);
			const envelope = JSON.parse(result.stdout) as {
				readonly schema: number;
				readonly exit_code: number;
				readonly error: { readonly tag: string };
			};
			assert.strictEqual(envelope.schema, 1);
			assert.strictEqual(envelope.exit_code, 3);
			assert.strictEqual(envelope.error.tag, "ConfigPathNotFoundError");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit lint: targets scope the reported diagnostics", () => {
	const seed = async (): Promise<Sandbox> => {
		const sandbox = await makeSandbox("okfit-lint-targets-");
		const init = await Effect.runPromise(runOkfit(["init"], sandbox).pipe(Effect.provide(NodeServices.layer)));
		assert.strictEqual(init.exitCode, 0);
		await writeFileDeep(
			join(sandbox.cwd, "okf", "glossary", "good.md"),
			"---\ntype: Glossary\ntitle: Good\ndescription: Good.\nstatus: stable\n---\n\n# Good\n",
		);
		await writeFileDeep(
			join(sandbox.cwd, "okf", "glossary", "bad.md"),
			"---\ntype: Glossary\ntitle: Bad\ndescription: Bad.\nstatus: stable\n---\n\n# Bad\n\nSee [gone](../nowhere/gone.md).\n",
		);
		return sandbox;
	};
	interface Diag {
		readonly file: string;
	}

	it.effect("reports only the named file's diagnostics while the whole bundle loads", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(seed);
			const all = yield* runOkfit(["lint", "--format", "json"], sandbox);
			const everything = JSON.parse(all.stdout) as { diagnostics: Diag[]; concepts: number };
			assert.isTrue(
				everything.diagnostics.some((d) => d.file === "glossary/bad.md"),
				all.stdout,
			);
			const scoped = yield* runOkfit(["lint", "okf/glossary/good.md", "--format", "json"], sandbox);
			const scopedBody = JSON.parse(scoped.stdout) as { diagnostics: Diag[]; concepts: number };
			assert.deepStrictEqual(scopedBody.diagnostics, []);
			assert.strictEqual(scopedBody.concepts, everything.concepts);
			const other = yield* runOkfit(["lint", "glossary/bad", "--format", "json"], sandbox);
			const otherBody = JSON.parse(other.stdout) as { diagnostics: Diag[] };
			assert.isAbove(otherBody.diagnostics.length, 0);
			assert.isTrue(otherBody.diagnostics.every((d) => d.file === "glossary/bad.md"));
			// flags after the variadic targets still parse as flags
			const after = yield* runOkfit(["lint", "glossary/bad", "glossary/good", "--format", "json"], sandbox);
			assert.isTrue(Array.isArray((JSON.parse(after.stdout) as { diagnostics: unknown }).diagnostics));
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("an unknown target exits 64", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(seed);
			const run = yield* runOkfit(["lint", "glossary/zzz"], sandbox);
			assert.strictEqual(run.exitCode, 64);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
