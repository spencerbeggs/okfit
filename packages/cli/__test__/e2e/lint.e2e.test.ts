// Acceptance suite for `okfit lint` (issue #17): same handler skeleton as
// `okfit validate`, minus the conformance tier. Spawns the built dist/dev
// bin (K-43), never Command.run in-process, per this package's e2e
// convention.
//
// K-44: no CLI-owned fixtures. Reuses the same profiles/core fixtures
// validate.e2e.test.ts already names.

import { join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { copyFixtureInto, makeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const CORE_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "core", "__test__", "fixtures");
const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");

const CLEAN_FIXTURE = join(PROFILES_FIXTURES, "software-project");
const LINT_BAD_FIXTURE = join(PROFILES_FIXTURES, "bad", "module-no-kind");
const CONFORMANCE_BAD_FIXTURE = join(CORE_FIXTURES, "bad", "c-frontmatter-missing");

describe("okfit lint: clean bundle", () => {
	it.effect("exits 0, prints only the summary to stderr", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));

			const result = yield* runOkfit(["lint"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout, "");
			assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 16 concepts (okf)\n");
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
