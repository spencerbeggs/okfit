// Acceptance suite for `okfit validate` (contract §6.2 `validate-*` rows,
// §6.2 `config-discovery.e2e.test.ts`'s matrix, and the K-9 no-state-files
// check), all folded into one file per this group's brief. Spawns the built
// built bin (K-43) — never Command.run in-process — so every exit code
// and every byte of stdout/stderr is what a real invocation produces.
//
// Fixture exception (K-44, recorded per decision 3 above): the OKFIT_NOW/
// stale case patches a copy of the clean software-project fixture with a
// `stale_after` field, because no shipped bad-bundle fixture sets one.
// Every other fixture here is a plain copy of an existing core/profiles
// fixture — no CLI-owned duplicate category.

import { readdirSync } from "node:fs";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Bundle, ConceptId } from "@okfit/core";
import { ENGINE_VERSION } from "@okfit/engine";
import { Derivation } from "@okfit/profiles";
import { Effect, Option } from "effect";
import {
	NON_CONCEPT_LINKS_PROJECT,
	UNDECLARED_PROJECT,
	V02_PROJECT,
	V03_PROJECT,
} from "../../../engine/__test__/fixtures/bundles.js";
import type { Sandbox } from "./utils/fixtures.js";
import { copyFixtureInto, makeSandbox, writeSeedInto } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";
import { TestPlatform } from "./utils/platform.js";
import { amendDate, commit, initRepo } from "./utils/repo.js";

const CORE_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "core", "__test__", "fixtures");
const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");

const CLEAN_FIXTURE = join(PROFILES_FIXTURES, "software-project");
const PROFILE_BAD_FIXTURE = join(PROFILES_FIXTURES, "bad", "no-project");
const LINT_BAD_FIXTURE = join(PROFILES_FIXTURES, "bad", "module-no-kind");
const CONFORMANCE_BAD_FIXTURE = join(CORE_FIXTURES, "bad", "c-frontmatter-unclosed");

const CONFIG_TOML = `[bundle]\npath = "okf"\nprofile = "software-project"\n`;

/** Writes `contents` to `path`, creating parent directories as needed. */
const writeFileDeep = async (path: string, contents: string): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents, "utf8");
};

/** Every regular file under `root`, recursively, as basenames (K-9 check). */
const filenamesUnder = (root: string): ReadonlyArray<string> => {
	try {
		return readdirSync(root, { recursive: true }).map(String);
	} catch {
		return [];
	}
};

/** K-9: no `store.db`/`cache.db` anywhere under the sandbox's HOME/XDG trees. */
const assertNoStateFiles = (env: Readonly<Record<string, string>>): void => {
	const roots = [env.HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME].filter(
		(value): value is string => value !== undefined,
	);
	const offenders = roots.flatMap((root) =>
		filenamesUnder(root).filter((name) => name.endsWith("store.db") || name.endsWith("cache.db")),
	);
	assert.deepStrictEqual(offenders, []);
};

describe("okfit validate: clean bundle", () => {
	it.effect("exits 0, prints only the summary to stderr, and leaves no state files (K-9)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout, "");
			// Captured this session: Bundle.load over the clean fixture with the
			// default merge (DEFAULTS < software-project, no file config) reports
			// zero conformance/lint/profile diagnostics and 6 concepts.
			assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 20 concepts (okf)\n");

			assertNoStateFiles(sandbox.env);
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: the declared OKF version", () => {
	const reported = (seed: Parameters<typeof writeSeedInto>[1]) =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, seed));
			const result = yield* runOkfit(["validate", "--format", "json"], sandbox);
			return (JSON.parse(result.stdout) as { readonly okf_version: unknown }).okf_version;
		}).pipe(Effect.provide(TestPlatform));

	it.effect("--format json reports the bundle's own declaration, null when it declares none", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* reported(V03_PROJECT), "0.3");
			// control: the same project minus its declaration reports null, so the value comes from the bundle
			assert.isNull(yield* reported(UNDECLARED_PROJECT));
		}),
	);
});

describe("okfit validate: the old key names hint (#493)", () => {
	const HINT = "hint: 2 concept(s) still use okfit's old frontmatter key names; run okfit sync to rename them";
	/** Gives a concept okfit's old `integrity:` block, written after its other keys. */
	const unmigrated = (text: string | undefined): string => {
		const old = (text ?? "").replace("\n---\n\n", "\nintegrity:\n  generated:\n    body: 47fef58df84c6eb2\n---\n\n");
		// a no-op replace would make every hint test below vacuous
		assert.notStrictEqual(old, text);
		return old;
	};
	const oldOf = (base: typeof V03_PROJECT): typeof V03_PROJECT => ({
		...base,
		"okf/metrics/revenue.md": unmigrated(base["okf/metrics/revenue.md"]),
		"okf/metrics/margin.md": unmigrated(base["okf/metrics/margin.md"]),
	});
	const OLD = oldOf(V03_PROJECT);
	const count = (text: string): number => text.split("hint:").length - 1;
	const runIn = (seed: typeof V03_PROJECT, args: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, seed));
			return yield* runOkfit(["validate", ...args], sandbox);
		}).pipe(Effect.provide(TestPlatform));

	it.effect("validate prints the sync hint once for an unmigrated bundle (#493)", () =>
		Effect.gen(function* () {
			const human = yield* runIn(OLD, []);
			assert.strictEqual(human.stderr.split(HINT).length - 1, 1, human.stderr);
			assert.notInclude(human.stdout, "hint:");
			// the old integrity block is no conformance error of its own, so the exit codes are comparable
			assert.strictEqual(human.exitCode, (yield* runIn(V03_PROJECT, [])).exitCode);
			const json = yield* runIn(OLD, ["--format", "json"]);
			const envelope = JSON.parse(json.stdout) as { readonly exit_code: number };
			assert.strictEqual(human.exitCode, envelope.exit_code);
		}),
	);

	it.effect("the hint counts the whole bundle when a positional target narrows the run", () =>
		Effect.gen(function* () {
			const result = yield* runIn(OLD, ["okf/modules/widget.md"]);
			assert.strictEqual(count(result.stderr), 1, result.stderr);
			assert.include(result.stderr, HINT);
		}),
	);

	it.effect("the hint prints with --target 0.3, after the summary line", () =>
		Effect.gen(function* () {
			const result = yield* runIn(OLD, ["--target", "0.3"]);
			assert.strictEqual(count(result.stderr), 1, result.stderr);
			const summary = result.stderr.indexOf("OKF 0.3:");
			assert.isAbove(summary, -1, result.stderr);
			assert.isAbove(result.stderr.indexOf(HINT), summary);
		}),
	);

	it.effect("the hint prints exactly once through a --fix re-run", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, oldOf(V02_PROJECT)));
			const before = yield* Effect.promise(() => readFile(join(sandbox.cwd, "okf/index.md"), "utf8"));
			const result = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.include(result.stderr, "OKF 0.3:");
			assert.strictEqual(count(result.stderr), 1, result.stderr);
			assert.include(result.stderr, HINT);
			assert.include(result.stdout, "Fixed");
			const after = yield* Effect.promise(() => readFile(join(sandbox.cwd, "okf/index.md"), "utf8"));
			assert.notStrictEqual(after, before, "the fix changed index.md on disk");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("no hint on a migrated bundle, and none under --format json", () =>
		Effect.gen(function* () {
			const migrated = yield* runIn(V03_PROJECT, []);
			assert.notInclude(migrated.stderr, "hint:");
			const json = yield* runIn(OLD, ["--format", "json"]);
			assert.notInclude(json.stdout, "hint:");
			assert.notInclude(json.stderr, "hint:");
		}),
	);
});

describe("okfit validate: profile-tier error", () => {
	it.effect("a missing Project concept is a profile error: exit 1, exact human line", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(PROFILE_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 1);
			// Captured this session: Profiles.softwareProject.check reports exactly
			// one bundle-level "project-missing" error; concepts=1 (modules/core.md).
			assert.strictEqual(
				result.stdout,
				"(bundle) error project-missing No Project concept in the bundle; software-project expects exactly one at the bundle root (project.md)\n",
			);
			assert.strictEqual(result.stderr, "1 errors, 0 warnings, 0 info in 1 concepts (okf)\n");
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: GitHub Actions annotations", () => {
	it.effect("--ci under GITHUB_ACTIONS adds a ::error annotation beside the unchanged line", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(PROFILE_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["validate", "--ci"], {
				cwd: sandbox.cwd,
				env: { ...sandbox.env, GITHUB_ACTIONS: "true" },
			});

			assert.strictEqual(result.exitCode, 1);
			const line =
				"(bundle) error project-missing No Project concept in the bundle; software-project expects exactly one at the bundle root (project.md)";
			assert.strictEqual(
				result.stdout,
				`${line}\n::error::project-missing No Project concept in the bundle; software-project expects exactly one at the bundle root (project.md)\n`,
			);
			assert.strictEqual(result.stderr, "1 errors, 0 warnings, 0 info in 1 concepts (okf)\n");
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: conformance beats a co-occurring profile error", () => {
	it.effect("a frontmatter-unclosed concept: exit 2, sorted stdout, both diagnostics counted", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CONFORMANCE_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 2);
			// Captured this session: this fixture has no project.md, so it also
			// carries a "project-missing" profile error (file "") alongside core's
			// conformance "frontmatter-unclosed" on unclosed.md — K-17 sorts the
			// bundle-level ("") entry first; conformance (exit 2) still beats the
			// co-occurring profile error (tier 1). concepts=0.
			assert.strictEqual(
				result.stdout,
				"(bundle) error project-missing No Project concept in the bundle; software-project expects exactly one at the bundle root (project.md)\n" +
					"unclosed.md:1:1 error frontmatter-unclosed frontmatter opens with --- but never closes\n",
			);
			assert.strictEqual(result.stderr, "2 errors, 0 warnings, 0 info in 0 concepts (okf)\n");
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: a .md with no frontmatter is skipped with a warning (OKF 0.3 §3.2)", () => {
	it.effect("exits 1 on the profile's project-missing alone; the skipped file is a core.lint warning", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() =>
				copyFixtureInto(join(CORE_FIXTURES, "bad", "c-frontmatter-missing"), join(sandbox.cwd, "okf")),
			);

			const result = yield* runOkfit(["validate", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 1);
			const body = JSON.parse(result.stdout) as {
				summary: { conformance_errors: number };
				diagnostics: Array<{ file: string; code: string; source: string; severity: string }>;
			};
			assert.strictEqual(body.summary.conformance_errors, 0);
			const skipped = body.diagnostics.find((d) => d.code === "frontmatter-missing");
			assert.strictEqual(skipped?.file, "no-front.md");
			assert.strictEqual(skipped?.source, "core.lint");
			assert.strictEqual(skipped?.severity, "warning");
			// Positive control: the profile error is the one that fails the run.
			assert.deepStrictEqual(
				body.diagnostics.filter((d) => d.severity === "error").map((d) => d.code),
				["project-missing"],
			);
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate --format json", () => {
	it.effect("deep-equals a fully specified envelope: schema 1, zero-based range, source, exit_code", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(LINT_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["validate", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 1);
			assert.strictEqual(result.stderr, "");
			const bundleRoot = join(sandbox.cwd, "okf");
			// Captured this session: one lint error, required-key-missing on
			// modules/core.md, offset 0 length 118 line 0 character 0; concepts=2.
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
					migration_findings: 0,
					concepts: 2,
				},
				diagnostics: [
					{
						source: "core.lint",
						file: "modules/core.md",
						code: "required-key-missing",
						severity: "error",
						message: 'Required key "x-okfit-kind" is missing',
						range: { offset: 0, length: 127, line: 0, character: 0 },
					},
				],
			});
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("an unknown profile: stderr is exactly the K-4 warning, stdout parses as one envelope", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			yield* Effect.promise(() =>
				writeFileDeep(join(sandbox.cwd, "okfit.toml"), `[bundle]\nprofile = "not-a-real-profile"\n`),
			);

			const result = yield* runOkfit(["validate", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, 'warning: unknown profile "not-a-real-profile"; continuing with defaults\n');
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
				profile: null,
				exit_code: 0,
				summary: {
					conformance_errors: 0,
					lint_errors: 0,
					lint_warnings: 0,
					lint_info: 0,
					profile_errors: 0,
					migration_findings: 0,
					concepts: 20,
				},
				diagnostics: [],
			});
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("exit 3 under json still gets the K-22 error envelope on stdout", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const missingConfig = join(sandbox.cwd, "does-not-exist.toml");

			const result = yield* runOkfit(["validate", "--format", "json", "--config", missingConfig], sandbox);

			assert.strictEqual(result.exitCode, 3);
			const envelope = JSON.parse(result.stdout) as {
				readonly schema: number;
				readonly okfit_version: string;
				readonly engine_version: string;
				readonly distribution: unknown;
				readonly exit_code: number;
				readonly error: { readonly tag: string; readonly message: string };
			};
			assert.strictEqual(envelope.schema, 1);
			assert.match(String(envelope.okfit_version), /^\d+\.\d+\.\d+/);
			assert.match(String(envelope.engine_version), /^\d+\.\d+\.\d+/);
			assert.isNull(envelope.distribution);
			assert.strictEqual(envelope.exit_code, 3);
			assert.strictEqual(envelope.error.tag, "ConfigPathNotFoundError");
			assert.strictEqual(envelope.error.message, `config path not found: ${missingConfig}`);
			assert.isTrue(result.stderr.includes(`error: config path not found: ${missingConfig}`));
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: config discovery", () => {
	it.effect("finds .config/okfit.toml two directories up", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, ".config", "okfit.toml"), CONFIG_TOML));
			const deepCwd = join(sandbox.cwd, "sub", "subsub");
			yield* Effect.promise(() => mkdir(deepCwd, { recursive: true }));

			const result = yield* runOkfit(["validate"], { ...sandbox, cwd: deepCwd });

			assert.strictEqual(result.exitCode, 0);
			// The anchor is the parent of `.config` — sandbox.cwd — so the bundle
			// root is `sandbox.cwd/okf`. Contract §3.3/K-51 renders a path relative
			// to cwd only when it is UNDER cwd; `sandbox.cwd/okf` is not under
			// `deepCwd` (it is two levels above deepCwd's own parent), so
			// `renderRoot` correctly falls back to the absolute path here — verified
			// against `commands/validate.ts`'s own `renderRoot` and the contract's
			// literal K-51 text, not the brief's original "../../okf" expectation,
			// which this test corrects (see task report for the discrepancy).
			assert.strictEqual(result.stderr, `0 errors, 0 warnings, 0 info in 20 concepts (${join(sandbox.cwd, "okf")})\n`);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("finds okfit.toml alone", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, "okfit.toml"), CONFIG_TOML));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 20 concepts (okf)\n");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("finds .okfit.toml alone", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, ".okfit.toml"), CONFIG_TOML));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 20 concepts (okf)\n");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("a project-local okfit.toml beats the XDG config", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, "okfit.toml"), CONFIG_TOML));
			yield* Effect.promise(() =>
				writeFileDeep(
					join(sandbox.env.XDG_CONFIG_HOME ?? "", "okfit", "config.toml"),
					`[bundle]\nprofile = "xdg-discovery-profile"\n`,
				),
			);

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.isFalse(result.stderr.includes("xdg-discovery-profile"));
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("falls through every tier and still runs on defaults when nothing is found", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 20 concepts (okf)\n");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("explicit --config short-circuits discovery and anchors on its own directory (K-1, K-10, K-12)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const elsewhere = join(sandbox.cwd, "..", "elsewhere");
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, elsewhere));
			const explicitConfigPath = join(elsewhere, "myconfig.toml");
			// A bogus profile of its own (distinct from the two competitors
			// below) so the K-4 warning it produces is itself discriminating:
			// only ITS name may appear on stderr.
			yield* Effect.promise(() =>
				writeFileDeep(explicitConfigPath, `[bundle]\npath = "okf"\nprofile = "explicit-config-profile"\n`),
			);

			// K-10/K-11 competitors: a project-local `okfit.toml` at the
			// sandbox cwd AND an `$XDG_CONFIG_HOME/okfit/config.toml` fallback,
			// each naming its own bogus profile. If `--config` did not actually
			// short-circuit discovery, one of these would win instead and its
			// (different) bogus-profile warning would appear on stderr.
			yield* Effect.promise(() =>
				writeFileDeep(join(sandbox.cwd, "okfit.toml"), `[bundle]\nprofile = "cwd-discovery-profile"\n`),
			);
			yield* Effect.promise(() =>
				writeFileDeep(
					join(sandbox.env.XDG_CONFIG_HOME ?? "", "okfit", "config.toml"),
					`[bundle]\nprofile = "xdg-discovery-profile"\n`,
				),
			);

			const result = yield* runOkfit(["validate", "--config", explicitConfigPath], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(
				result.stderr,
				'warning: unknown profile "explicit-config-profile"; continuing with defaults\n' +
					`0 errors, 0 warnings, 0 info in 20 concepts (${join(elsewhere, "okf")})\n`,
			);
			assert.isFalse(result.stderr.includes("cwd-discovery-profile"));
			assert.isFalse(result.stderr.includes("xdg-discovery-profile"));
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("missing --config: exit 3 with the exact K-51 message", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const missingConfig = join(sandbox.cwd, "does-not-exist.toml");

			const result = yield* runOkfit(["validate", "--config", missingConfig], sandbox);

			assert.strictEqual(result.exitCode, 3);
			assert.strictEqual(result.stdout, "");
			assert.isTrue(result.stderr.includes(`error: config path not found: ${missingConfig}\n`));
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("malformed TOML: exit 3, stderr names the file (K-46 fix round 1)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const badConfigPath = join(sandbox.cwd, "bad.toml");
			yield* Effect.promise(() => writeFileDeep(badConfigPath, `[bundle\npath = "okf"\n`));

			const result = yield* runOkfit(["validate", "--config", badConfigPath], sandbox);

			assert.strictEqual(result.exitCode, 3);
			// `@effected/config-file`'s `ConfigCodecError` carries no `path` field
			// of its own (verified against its installed `.d.ts`/`.js`: `codec`,
			// `operation`, `cause` only, `message` is `${codec} ${operation}
			// failed`) — `@okfit/engine`'s `config/layer.ts#provideConfig` now wraps it into
			// `ConfigMalformedError` with the KNOWN `--config` path (K-46 fix
			// round 1), so this asserts the exact, pinned message the wrapped
			// error renders (captured this session by running the CLI directly
			// against this fixture — see task report).
			assert.strictEqual(result.stderr, `error: malformed config ${badConfigPath}: toml parse failed\n`);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect(
		"discovery branch: a schema-invalid discovered config also names the file, when the library's own path is known (K-46 fix round 1)",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* Effect.promise(() => makeSandbox());
				const configPath = join(sandbox.cwd, "okfit.toml");
				// Parses as valid TOML but violates OkfitConfig's schema (`bundle.profile`
				// must be a string) — a ConfigValidationError, not a ConfigCodecError;
				// unlike ConfigCodecError, its own `path` field is populated here, so
				// wrapping does not need an explicit `--config` to know the path.
				yield* Effect.promise(() => writeFileDeep(configPath, `[bundle]\nprofile = 123\n`));

				const result = yield* runOkfit(["validate"], sandbox);

				assert.strictEqual(result.exitCode, 3);
				// Captured this session by running the CLI directly against this
				// fixture: `ConfigValidationError`'s own message already embeds the
				// path once; `ConfigMalformedError` prefixes it with `malformed
				// config <path>: ` regardless, per the K-46 fix's single message shape.
				assert.strictEqual(result.stderr, `error: malformed config ${configPath}: bundle.profile: Expected string\n`);
			}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("a bad lint level names the key in the error line and in the JSON envelope", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const configPath = join(sandbox.cwd, "okfit.toml");
			yield* Effect.promise(() => writeFileDeep(configPath, `[lint]\nmissing_index = "loud"\n`));

			const human = yield* runOkfit(["validate"], sandbox);
			assert.strictEqual(human.exitCode, 3);
			assert.include(human.stderr, "lint.missing_index");

			const json = yield* runOkfit(["validate", "--format", "json"], sandbox);
			assert.strictEqual(json.exitCode, 3);
			const envelope = JSON.parse(json.stderr.length > 0 && json.stdout.length === 0 ? json.stderr : json.stdout);
			assert.include(envelope.error.message, "lint.missing_index");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("unknown profile: warning on stderr, continues with defaults (K-4)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			yield* Effect.promise(() =>
				writeFileDeep(join(sandbox.cwd, "okfit.toml"), `[bundle]\nprofile = "not-a-real-profile"\n`),
			);

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.isTrue(
				result.stderr.startsWith('warning: unknown profile "not-a-real-profile"; continuing with defaults\n'),
			);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("XDG_CONFIG_HOME fallback is read when no project-local config exists (K-11)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			// Naming an unknown profile is what proves the XDG file's VALUE was
			// read, not merely that discovery did not error.
			yield* Effect.promise(() =>
				writeFileDeep(
					join(sandbox.env.XDG_CONFIG_HOME ?? "", "okfit", "config.toml"),
					`[bundle]\nprofile = "xdg-only-profile"\n`,
				),
			);

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.isTrue(
				result.stderr.startsWith('warning: unknown profile "xdg-only-profile"; continuing with defaults\n'),
			);
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: OKFIT_NOW", () => {
	it.effect("makes a stale-after diagnostic deterministic regardless of the wall clock (K-47)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const bundleRoot = join(sandbox.cwd, "okf");
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			// Patch a copy of the clean fixture's modules/core.md with a stale_after
			// in the past (decision 3): no shipped bad-bundle fixture sets one.
			const concept = join(bundleRoot, "modules", "core.md");
			const original = yield* Effect.promise(() => readFile(concept, "utf8"));
			yield* Effect.promise(() =>
				writeFile(
					concept,
					original.replace("tags: [architecture]\n---", "tags: [architecture]\nstale_after: 2026-10-01T00:00:00Z\n---"),
					"utf8",
				),
			);

			const before = yield* runOkfit(["validate"], {
				...sandbox,
				env: { ...sandbox.env, OKFIT_NOW: "2026-09-10T00:00:00Z" },
			});
			assert.strictEqual(before.exitCode, 0);
			assert.strictEqual(before.stdout, "");

			const after = yield* runOkfit(["validate"], {
				...sandbox,
				env: { ...sandbox.env, OKFIT_NOW: "2026-11-01T00:00:00Z" },
			});
			assert.strictEqual(after.exitCode, 0);
			// Captured this session: severity "info" (DEFAULT_LINT's stale: "info"),
			// so the exit code never moves; only the diagnostic's presence does.
			// `stale` anchors at the `stale_after` value itself, not the frontmatter
			// block (phase 4 decision 2), so the range now points at line 9 (the
			// inserted `stale_after:` line), column 14 (the value, past the key).
			assert.strictEqual(
				after.stdout,
				"modules/core.md:9:14 info stale Concept is stale since 2026-10-01T00:00:00.000Z\n",
			);
			assert.strictEqual(after.stderr, "0 errors, 0 warnings, 1 info in 20 concepts (okf)\n");
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: generated-at-drift lint (drift-lint e2e)", () => {
	const DRIFT_ENV = (env: Readonly<Record<string, string>>): Record<string, string> => ({
		...env,
		PATH: process.env.PATH ?? "",
		NO_COLOR: "1",
		// S-17/Global Constraints: identity is set IN-REPO by repo.ts's
		// initRepo, never HOME=.
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	});

	// `verified` is required here so the fixture exercises ONLY the
	// generated-at-drift lint: software-project's own config sets
	// `require_verified: true` for the `Decision` type (default severity
	// "error"), and an unverified Decision would otherwise add its own
	// `require-verified-unmet` error to every case below, unrelated to
	// drift -- a gap in the task brief's own fixture draft (see task
	// report). Modelled on `packages/profiles/__test__/fixtures/software-project/okf/decisions/effect-v4.md`'s
	// own hand-authored `verified` block; this is fixture data, not a run
	// of `okfit verify` (Global Constraints' distinction).
	const DRIFT_DECISION = [
		"---",
		"type: Decision",
		"title: Drift decision",
		"description: A decision with a generated.by but no at, to exercise the drift lint.",
		"generated:",
		"  by: human:ada",
		"status: draft",
		"verified:",
		"  - by: human:ada",
		"    at: 2026-09-02T00:00:00Z",
		"---",
		"",
		"# Drift decision",
		"",
	].join("\n");

	/** A git repo scaffolded by a real `okfit init`, plus one committed Decision with `generated.by` but no `at`. */
	const seedDriftRepo = () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-drift-"));
			const env = DRIFT_ENV(sandbox.env);
			yield* Effect.promise(() => initRepo(sandbox.cwd, env));
			const init = yield* runOkfit(["init"], {
				cwd: sandbox.cwd,
				env: { ...env, OKFIT_NOW: "2026-09-01T00:00:00.000Z" },
			});
			assert.strictEqual(init.exitCode, 0);
			yield* Effect.promise(() =>
				commit(sandbox.cwd, { message: "okfit init", authoredAt: "2026-09-01T00:00:00+00:00" }, env),
			);
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, "okf", "decisions", "drift.md"), DRIFT_DECISION));
			yield* Effect.promise(() =>
				commit(sandbox.cwd, { message: "add drift decision", authoredAt: "2026-09-02T00:00:00+00:00" }, env),
			);
			return { cwd: sandbox.cwd, env };
		});

	it.effect("reports generated-at-drift at warn by default and does not change the exit code", () =>
		Effect.gen(function* () {
			const { cwd, env } = yield* seedDriftRepo();

			const result = yield* runOkfit(["validate", "--format", "json"], { cwd, env });

			assert.strictEqual(result.exitCode, 0);
			const envelope = JSON.parse(result.stdout) as {
				readonly summary: { readonly lint_errors: number; readonly lint_warnings: number };
				readonly diagnostics: ReadonlyArray<{
					readonly code: string;
					readonly severity: string;
					readonly file: string;
				}>;
			};
			assert.strictEqual(envelope.summary.lint_errors, 0);
			assert.isTrue(envelope.summary.lint_warnings >= 1);
			const drift = envelope.diagnostics.find((diagnostic) => diagnostic.code === "generated-at-drift");
			assert.isDefined(drift);
			assert.strictEqual(drift?.severity, "warning");
			assert.strictEqual(drift?.file, "decisions/drift.md");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("does not report generated-at-drift when the recorded digest still matches the body (issue #19)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-drift-authoritative-"));
			const env = DRIFT_ENV(sandbox.env);
			yield* Effect.promise(() => initRepo(sandbox.cwd, env));
			const init = yield* runOkfit(["init"], {
				cwd: sandbox.cwd,
				env: { ...env, OKFIT_NOW: "2026-09-01T00:00:00.000Z" },
			});
			assert.strictEqual(init.exitCode, 0);
			yield* Effect.promise(() =>
				commit(sandbox.cwd, { message: "okfit init", authoredAt: "2026-09-01T00:00:00+00:00" }, env),
			);
			// The body's own `generated.body_sha256` is stamped when the concept is first committed
			// (body-digest design, issue #19) -- computed the same way `okfit sync` would.
			const body = "# Authoritative decision\n\nBody text.\n";
			const withoutStamp = [
				"---",
				"type: Decision",
				"title: Authoritative decision",
				"description: A decision whose digest survives a history rewrite (issue #19).",
				"generated:",
				"  by: human:ada",
				"status: draft",
				"verified:",
				"  - by: human:ada",
				"    at: 2026-09-02T00:00:00Z",
				"---",
				"",
				body,
			].join("\n");
			const digest = yield* Derivation.bodyDigest(withoutStamp);
			const stamped = withoutStamp.replace(
				"generated:\n  by: human:ada\n",
				`generated:\n  by: human:ada\n  at: 2026-09-02T00:00:00Z\n  body_sha256: ${digest}\n`,
			);
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, "okf", "decisions", "authoritative.md"), stamped));
			yield* Effect.promise(() =>
				commit(sandbox.cwd, { message: "add authoritative decision", authoredAt: "2026-09-02T00:00:00+00:00" }, env),
			);
			// ...then HEAD's author date is rewritten in place, with no tree change -- exactly what a
			// squash/rebase merge does to every commit it rewrites (issue #19): the body, digest
			// included, is carried verbatim. `derived.at` moves; the digest does not.
			yield* Effect.promise(() => amendDate(sandbox.cwd, "2026-09-05T00:00:00+00:00", env));

			const result = yield* runOkfit(["validate", "--format", "json"], { cwd: sandbox.cwd, env });

			assert.strictEqual(result.exitCode, 0);
			const envelope = JSON.parse(result.stdout) as {
				readonly diagnostics: ReadonlyArray<{ readonly code: string }>;
			};
			assert.isUndefined(envelope.diagnostics.find((diagnostic) => diagnostic.code === "generated-at-drift"));
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("escalates generated-at-drift to exit 1 at error severity", () =>
		Effect.gen(function* () {
			const { cwd, env } = yield* seedDriftRepo();
			yield* Effect.promise(() =>
				writeFileDeep(
					join(cwd, "okfit.toml"),
					'[bundle]\npath = "okf"\nprofile = "software-project"\n\n[lint]\ngenerated_at_drift = "error"\n',
				),
			);

			const result = yield* runOkfit(["validate", "--format", "json"], { cwd, env });

			assert.strictEqual(result.exitCode, 1);
			const envelope = JSON.parse(result.stdout) as {
				readonly summary: { readonly lint_errors: number };
				readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly severity: string }>;
			};
			assert.strictEqual(envelope.summary.lint_errors, 1);
			const drift = envelope.diagnostics.find((diagnostic) => diagnostic.code === "generated-at-drift");
			assert.strictEqual(drift?.severity, "error");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("suppresses the git walk entirely when the lint is off", () =>
		Effect.gen(function* () {
			const { cwd, env } = yield* seedDriftRepo();
			yield* Effect.promise(() =>
				writeFileDeep(
					join(cwd, "okfit.toml"),
					'[bundle]\npath = "okf"\nprofile = "software-project"\n\n[lint]\ngenerated_at_drift = "off"\n',
				),
			);
			// No `git` reachable at all: if Provenance.lint still ran despite
			// "off", the spawn itself would fail (ENOENT) and this would surface
			// as an infrastructure failure, not a clean run -- proving the
			// CLI's own severity gate (S-8, @okfit/engine's validate/run.ts#run) skips the call
			// entirely rather than calling Provenance.lint and discarding its
			// result.
			const noGitEnv = { ...env, PATH: "" };

			const result = yield* runOkfit(["validate", "--format", "json"], { cwd, env: noGitEnv });

			assert.strictEqual(result.exitCode, 0);
			const envelope = JSON.parse(result.stdout) as { readonly diagnostics: ReadonlyArray<{ readonly code: string }> };
			assert.isUndefined(envelope.diagnostics.find((diagnostic) => diagnostic.code === "generated-at-drift"));
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--skip-provenance suppresses the git walk without touching [lint] (S-31)", () =>
		Effect.gen(function* () {
			const { cwd, env } = yield* seedDriftRepo();
			// The config is left at its default severity (info, not "off") --
			// the same drift fixture as the first two cases above would append
			// a generated-at-drift diagnostic here if the flag did nothing. No
			// `git` reachable at all: if `--skip-provenance` still called
			// Provenance.lint, the spawn itself would fail (ENOENT), surfacing
			// as an infrastructure failure rather than a clean run -- the same
			// "off" proof one case up, but for the flag instead of the config.
			const noGitEnv = { ...env, PATH: "" };

			const result = yield* runOkfit(["validate", "--skip-provenance", "--format", "json"], {
				cwd,
				env: noGitEnv,
			});

			assert.strictEqual(result.exitCode, 0);
			const envelope = JSON.parse(result.stdout) as { readonly diagnostics: ReadonlyArray<{ readonly code: string }> };
			assert.deepStrictEqual(
				envelope.diagnostics.filter((diagnostic) => diagnostic.code === "generated-at-drift"),
				[],
			);
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate --document", () => {
	it.effect(
		"validates stdin in place of the file, leaves the file untouched, and rejects a path outside the bundle",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* Effect.promise(() => makeSandbox());
				yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
				const target = join(sandbox.cwd, "okf", "glossary", "bundle.md");
				const original = yield* Effect.promise(() => readFile(target, "utf8"));

				// Control: the clean fixture reports nothing on stdout.
				const clean = yield* runOkfit(["validate"], sandbox);
				assert.strictEqual(clean.stdout, "");

				const draft = `${original}\nSee [nowhere](nowhere.md).\n`;
				const drafted = yield* runOkfit(["validate", "--document", "glossary/bundle.md"], { ...sandbox, stdin: draft });
				assert.include(drafted.stdout, "glossary/bundle.md");
				assert.include(drafted.stdout, "broken-links");
				assert.strictEqual(yield* Effect.promise(() => readFile(target, "utf8")), original);

				const escaping = yield* runOkfit(["validate", "--document", "../escape.md"], { ...sandbox, stdin: "x" });
				assert.strictEqual(escaping.exitCode, 64);
				assert.include(escaping.stderr, 'error: document path "../escape.md" resolves outside the bundle root');
			}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit --root", () => {
	it.effect("takes the project root as --root, from any cwd", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-root-"));
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			const elsewhere = dirname(sandbox.cwd);
			const run = yield* runOkfit(["validate", "--root", sandbox.cwd, "--format", "json"], {
				...sandbox,
				cwd: elsewhere,
			});
			assert.strictEqual(run.exitCode, 0);
			assert.strictEqual(JSON.parse(run.stdout).root, join(sandbox.cwd, "okf"));
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("no longer accepts the project root as a positional", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-root-positional-"));
			const run = yield* runOkfit(["context", sandbox.cwd], sandbox);
			assert.strictEqual(run.exitCode, 64);
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: targets scope the reported diagnostics", () => {
	const seed = async (): Promise<Sandbox> => {
		const sandbox = await makeSandbox("okfit-validate-targets-");
		const init = await Effect.runPromise(runOkfit(["init"], sandbox).pipe(Effect.provide(TestPlatform)));
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
			const all = yield* runOkfit(["validate", "--format", "json"], sandbox);
			const everything = JSON.parse(all.stdout) as { diagnostics: Diag[]; concepts: number };
			assert.isTrue(
				everything.diagnostics.some((d) => d.file === "glossary/bad.md"),
				all.stdout,
			);
			const scoped = yield* runOkfit(["validate", "okf/glossary/good.md", "--format", "json"], sandbox);
			const scopedBody = JSON.parse(scoped.stdout) as { diagnostics: Diag[]; concepts: number };
			assert.deepStrictEqual(scopedBody.diagnostics, []);
			assert.strictEqual(scopedBody.concepts, everything.concepts);
			const other = yield* runOkfit(["validate", "glossary/bad", "--format", "json"], sandbox);
			const otherBody = JSON.parse(other.stdout) as { diagnostics: Diag[] };
			assert.isAbove(otherBody.diagnostics.length, 0);
			assert.isTrue(otherBody.diagnostics.every((d) => d.file === "glossary/bad.md"));
			// flags after the variadic targets still parse as flags
			const after = yield* runOkfit(["validate", "glossary/bad", "glossary/good", "--format", "json"], sandbox);
			assert.strictEqual(after.exitCode, other.exitCode);
			assert.notStrictEqual(after.exitCode, 64);
			const afterBody = JSON.parse(after.stdout) as { diagnostics: Diag[] };
			assert.isTrue(afterBody.diagnostics.some((d) => d.file === "glossary/bad.md"));
			assert.isTrue(afterBody.diagnostics.every((d) => d.file === "glossary/bad.md"));
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("an unknown target exits 64", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(seed);
			const run = yield* runOkfit(["validate", "glossary/zzz"], sandbox);
			assert.strictEqual(run.exitCode, 64);
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: a file that does not decode", () => {
	it.effect("is still checked when named as a target", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CONFORMANCE_BAD_FIXTURE, join(sandbox.cwd, "okf")));
			const run = yield* runOkfit(["validate", join(sandbox.cwd, "okf", "unclosed.md"), "--format", "json"], sandbox);
			assert.strictEqual(run.exitCode, 2);
			const body = JSON.parse(run.stdout) as { diagnostics: Array<{ file: string; code: string }> };
			assert.deepStrictEqual(
				body.diagnostics.map((d) => d.file),
				["unclosed.md"],
			);
			assert.strictEqual(body.diagnostics[0]?.code, "frontmatter-unclosed");
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: an unparseable file", () => {
	it.effect("is still checked when named as a target", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-broken-"));
			const init = yield* runOkfit(["init"], sandbox);
			assert.strictEqual(init.exitCode, 0);
			const broken = join(sandbox.cwd, "okf", "decisions", "broken.md");
			yield* Effect.promise(() => writeFileDeep(broken, "---\ntitle: [unclosed\n---\n"));
			const run = yield* runOkfit(["validate", broken, "--format", "json"], sandbox);
			assert.strictEqual(run.exitCode, 2);
			const body = JSON.parse(run.stdout) as { diagnostics: Array<{ file: string; code: string }> };
			assert.isTrue(
				body.diagnostics.some((d) => d.file === "decisions/broken.md" && d.code === "frontmatter-unparseable"),
				run.stdout,
			);
			assert.isTrue(body.diagnostics.every((d) => d.file === "decisions/broken.md"));
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: --target, --fix, --only, --dry-run", () => {
	const seed = (name: string, files: Record<string, string> = V02_PROJECT) =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox(name));
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, files));
			return sandbox;
		});
	const read = (sandbox: Sandbox, path: string) => Effect.promise(() => readFile(join(sandbox.cwd, path), "utf8"));
	const COMPUTATION = "okf/computations/revenue-ytd.md";

	it.effect("reports four migrate findings, exits 0, and counts them in the summary", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-target-");
			const run = yield* runOkfit(["validate", "--target", "0.3", "--format", "json"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			const body = JSON.parse(run.stdout) as {
				target: string;
				summary: { migration_findings: number };
				diagnostics: Array<{ source: string; code: string }>;
			};
			assert.strictEqual(body.target, "0.3");
			assert.strictEqual(body.summary.migration_findings, 4);
			assert.strictEqual(body.diagnostics.filter((d) => d.source === "migrate").length, 4);
			// control: without --target the same bundle has no migrate diagnostics
			const plain = yield* runOkfit(["validate", "--format", "json"], sandbox);
			const plainBody = JSON.parse(plain.stdout) as { summary: { migration_findings: number }; target?: string };
			assert.strictEqual(plainBody.summary.migration_findings, 0);
			assert.isUndefined(plainBody.target);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("prints migrate findings in the list and one summary line in human output", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-target-human-");
			const run = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			assert.include(run.stdout, "okf-version-older");
			assert.include(run.stdout, "root-relative-path");
			assert.include(run.stderr, "OKF 0.3: 4 finding(s), 3 fixable with --fix");
		}).pipe(Effect.provide(TestPlatform)),
	);

	const PROSE = "okf/computations/prose.md";
	const proseOnly = (V03_PROJECT[COMPUTATION] as string)
		.replace(/```sql\n[^`]*```\n/, "Run the query.\n")
		.replace("## Computation", "# Computation");
	/** Undeclared with one prose-only computation: the only refusal is the lost computation. */
	const { [COMPUTATION]: _revenue, ...undeclaredWithout } = UNDECLARED_PROJECT;
	const refusedSeed = { ...undeclaredWithout, [PROSE]: proseOnly };

	it.effect("the summary counts a refused version fix apart (#498)", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-refused-", refusedSeed);
			const run = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			assert.include(
				run.stderr,
				"OKF 0.3: 2 finding(s), 0 fixable with --fix, 1 refused by --fix (run with --fix --dry-run to see why)",
			);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--document with --target counts refusals over the overlaid bundle", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-overlay-", refusedSeed);
			const refused = "1 refused by --fix";
			// control: on disk the prose-only computation is refused
			const disk = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.include(disk.stderr, refused);
			// the overlay restores the computation, so the cause of the refusal is gone from the bundle being checked
			const overlaid = yield* runOkfit(["validate", "--target", "0.3", "--document", "computations/prose.md"], {
				...sandbox,
				stdin: V03_PROJECT[COMPUTATION] as string,
			});
			assert.include(overlaid.stderr, "OKF 0.3:"); // the summary is there, so "no refused" is not vacuous
			assert.notInclude(overlaid.stderr, "refused");
			assert.strictEqual(yield* read(sandbox, PROSE), proseOnly, "the file on disk is untouched");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("the summary has no refused part when every fix applies", () =>
		Effect.gen(function* () {
			const files = {
				...UNDECLARED_PROJECT,
				[COMPUTATION]: (V03_PROJECT[COMPUTATION] as string)
					.replace("type: Attested Computation", "type: Metric")
					.replace("runtime: sql\n", "")
					.replace("attester:\n  resource: /references/attesters/check.py\n", "")
					.replace("(/metrics/revenue.md)", "(metrics/revenue.md)"),
			};
			const sandbox = yield* seed("okfit-validate-notrefused-", files);
			const run = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.include(run.stderr, "OKF 0.3: 2 finding(s), 2 fixable with --fix");
			assert.notInclude(run.stderr, "refused");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("after a refused --fix the re-run summary still says refused, and exit stays 0", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-refused-fix-", refusedSeed);
			const run = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			assert.include(run.stdout, "refused: index.md:");
			assert.include(run.stderr, "1 refused by --fix");
			assert.notInclude(run.stderr, "to see why"); // the refusals are printed right there
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("after a successful --fix the re-run summary has no refused part", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-fixed-");
			const run = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			assert.include(run.stderr, "OKF 0.3: 0 finding(s), 0 fixable with --fix");
			assert.notInclude(run.stderr, "refused");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("with a positional target, fixable plus refused equals the displayed findings with a fix", () =>
		Effect.gen(function* () {
			// Undeclared (a version fix the prose-only concept refuses) plus one root-only link in a concept.
			const files = {
				...refusedSeed,
				[COMPUTATION]: (V03_PROJECT[COMPUTATION] as string)
					.replace("type: Attested Computation", "type: Metric")
					.replace("runtime: sql\n", "")
					.replace("attester:\n  resource: /references/attesters/check.py\n", "")
					.replace("(/metrics/revenue.md)", "(metrics/revenue.md)"),
			};
			const sandbox = yield* seed("okfit-validate-positional-", files);
			const all = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.include(
				all.stderr,
				"OKF 0.3: 3 finding(s), 1 fixable with --fix, 1 refused by --fix (run with --fix --dry-run to see why)",
			);
			const narrowed = yield* runOkfit(["validate", "--target", "0.3", COMPUTATION], sandbox);
			assert.strictEqual(narrowed.exitCode, 0);
			assert.include(narrowed.stderr, "OKF 0.3: 1 finding(s), 1 fixable with --fix");
			assert.notInclude(narrowed.stderr, "refused");
			const index = yield* runOkfit(["validate", "--target", "0.3", "okf/index.md"], sandbox);
			assert.include(
				index.stderr,
				"OKF 0.3: 1 finding(s), 0 fixable with --fix, 1 refused by --fix (run with --fix --dry-run to see why)",
			);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("rejects every other --target and every flag combination the brief refuses, with exit 64", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-usage-");
			const old = yield* runOkfit(["validate", "--target", "0.2"], sandbox);
			assert.strictEqual(old.exitCode, 64);
			assert.include(old.stderr, '--target accepts only "0.3", the OKF version this okfit implements');
			const noTarget = yield* runOkfit(["validate", "--fix"], sandbox);
			assert.strictEqual(noTarget.exitCode, 64);
			const doc = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--document", "index.md"], sandbox);
			assert.strictEqual(doc.exitCode, 64);
			const onlyAlone = yield* runOkfit(["validate", "--target", "0.3", "--only", "okf-version"], sandbox);
			assert.strictEqual(onlyAlone.exitCode, 64);
			const dryAlone = yield* runOkfit(["validate", "--target", "0.3", "--dry-run"], sandbox);
			assert.strictEqual(dryAlone.exitCode, 64);
			// control: the same sandbox validates with a valid target
			const ok = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.strictEqual(ok.exitCode, 0);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--fix --dry-run says what it would fix and changes no file", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-dry-");
			const before = yield* read(sandbox, COMPUTATION);
			const index = yield* read(sandbox, "okf/index.md");
			const run = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--dry-run"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			assert.include(run.stdout, "Would fix 3 finding(s) in 2 file(s)");
			assert.strictEqual(yield* read(sandbox, COMPUTATION), before);
			assert.strictEqual(yield* read(sandbox, "okf/index.md"), index);
			assert.notStrictEqual(before, V03_PROJECT[COMPUTATION]);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--fix writes the fixes, leaves a clean plain validate, and reports the fixes in JSON", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-fix-");
			const run = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--format", "json"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			const body = JSON.parse(run.stdout) as {
				fixes: { applied: Array<{ path: string }>; refused: unknown[]; drifts: string[]; dry_run: boolean };
			};
			assert.strictEqual(body.fixes.applied.length, 2);
			assert.isFalse(body.fixes.dry_run);
			assert.strictEqual(yield* read(sandbox, COMPUTATION), V03_PROJECT[COMPUTATION]);
			const after = yield* runOkfit(["validate", "--format", "json"], sandbox);
			const afterBody = JSON.parse(after.stdout) as { diagnostics: Array<{ code: string }> };
			assert.strictEqual(afterBody.diagnostics.filter((d) => d.code === "broken-links").length, 0);
			// control: the sandbox had a root-fallback bundle before the fix
			assert.notStrictEqual(V02_PROJECT[COMPUTATION], V03_PROJECT[COMPUTATION]);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--fix --only okf-version prints the refused line and leaves index.md unchanged", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-only-");
			const index = yield* read(sandbox, "okf/index.md");
			const run = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--only", "okf-version"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			assert.include(run.stdout, "refused: index.md: 2 reference(s) still resolve only from the bundle root");
			assert.strictEqual(yield* read(sandbox, "okf/index.md"), index);
			// control: narrowing to the path fix does write the computation
			const paths = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--only", "root-relative-path"], sandbox);
			assert.strictEqual(paths.exitCode, 0);
			assert.strictEqual(yield* read(sandbox, COMPUTATION), V03_PROJECT[COMPUTATION]);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("a refused --target under --format json also prints the K-22 error envelope on stdout", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-usage-json-");
			const run = yield* runOkfit(["validate", "--target", "0.2", "--format", "json"], sandbox);
			assert.strictEqual(run.exitCode, 64);
			const body = JSON.parse(run.stdout) as { exit_code: number; error: { tag: string; message: string } };
			assert.strictEqual(body.exit_code, 64);
			assert.strictEqual(body.error.tag, "ValidateUsageError");
			assert.include(body.error.message, '--target accepts only "0.3"');
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--target abc and --only foo are usage errors (exit 64)", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-bad-values-");
			const abc = yield* runOkfit(["validate", "--target", "abc"], sandbox);
			assert.strictEqual(abc.exitCode, 64);
			assert.include(abc.stderr, '--target accepts only "0.3", the OKF version this okfit implements');
			const foo = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--only", "foo"], sandbox);
			assert.strictEqual(foo.exitCode, 64);
			// control: a known kind is accepted
			const ok = yield* runOkfit(
				["validate", "--target", "0.3", "--fix", "--dry-run", "--only", "okf-version"],
				sandbox,
			);
			assert.strictEqual(ok.exitCode, 0);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--fix on a real run prints Fixed <n> finding(s) in <m> file(s)", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-fixed-line-");
			const run = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.strictEqual(run.exitCode, 0);
			assert.include(run.stdout, "Fixed 3 finding(s) in 2 file(s)");
			assert.notInclude(run.stdout, "Would fix");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--fix prints a refused: line for a lost computation and keeps okf_version", () =>
		Effect.gen(function* () {
			// Only the index and the two concepts: the shared project's own computation would add findings of its own.
			const seeded = {
				...Object.fromEntries(
					Object.entries(UNDECLARED_PROJECT).filter(([path]) => !path.startsWith("okf/") || path === "okf/index.md"),
				),
				"okf/computations/revenue-ytd.md": V03_PROJECT[COMPUTATION] as string,
				"okf/computations/prose.md": (V03_PROJECT[COMPUTATION] as string)
					.replace(/```sql\n[^`]*```\n/, "Run the query.\n")
					.replace("## Computation", "# Computation"),
			};
			const sandbox = yield* seed("okfit-validate-lost-computation-", seeded);
			const index = yield* read(sandbox, "okf/index.md");
			const run = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.include(run.stdout, "refused: index.md: 1 Attested Computation(s) would have no computation");
			const after = yield* read(sandbox, "okf/index.md");
			assert.strictEqual(after, index);
			assert.notInclude(after, "okf_version");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("a refused fix appears in the JSON fixes.refused array", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-refused-json-");
			const run = yield* runOkfit(
				["validate", "--target", "0.3", "--fix", "--only", "okf-version", "--format", "json"],
				sandbox,
			);
			assert.strictEqual(run.exitCode, 0);
			const body = JSON.parse(run.stdout) as {
				fixes: { applied: unknown[]; refused: Array<{ file: string; code: string; reason: string }> };
			};
			assert.deepStrictEqual(body.fixes.applied, []);
			assert.strictEqual(body.fixes.refused.length, 1);
			assert.strictEqual(body.fixes.refused[0]?.file, "index.md");
			assert.strictEqual(body.fixes.refused[0]?.code, "okf-version-older");
			assert.include(body.fixes.refused[0]?.reason, "2 reference(s) still resolve only from the bundle root");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect(
		"--fix on a root index with malformed YAML refuses the version, fixes the rest and exits as validate does",
		() =>
			Effect.gen(function* () {
				const broken = '---\nokf_version: "0.2"\nbad: [\n---\n\n# B\n';
				const sandbox = yield* seed("okfit-validate-bad-index-", { ...V02_PROJECT, "okf/index.md": broken });
				const plain = yield* runOkfit(["validate"], sandbox);
				// the malformed index is a conformance error, so plain validate already exits non-zero
				assert.notStrictEqual(plain.exitCode, 0);
				const run = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
				assert.strictEqual(run.exitCode, plain.exitCode);
				assert.notStrictEqual(run.exitCode, 3);
				assert.match(
					run.stdout,
					/refused: index\.md: the root index frontmatter does not parse \(.+\); fix it by hand/,
				);
				assert.strictEqual(yield* read(sandbox, "okf/index.md"), broken);
				// the root-relative fixes in the same plan are applied
				assert.strictEqual(yield* read(sandbox, COMPUTATION), V03_PROJECT[COMPUTATION]);
				// control: the same bundle with a valid root index has its version fixed
				const good = yield* seed("okfit-validate-good-index-");
				const fixed = yield* runOkfit(["validate", "--target", "0.3", "--fix"], good);
				assert.strictEqual(fixed.exitCode, 0);
				assert.notInclude(fixed.stdout, "refused:");
			}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--fix --dry-run names each file and its fixes (#482)", () =>
		Effect.gen(function* () {
			// Only the index and the two concepts: the shared project's own computation would add findings of its own.
			const seeded = {
				...Object.fromEntries(
					Object.entries(UNDECLARED_PROJECT).filter(([path]) => !path.startsWith("okf/") || path === "okf/index.md"),
				),
				"okf/decisions/q.md": "---\ntype: Decision\n---\n\n# Q\n\n[a](decisions/q.md) and [b](notes/r.md)\n",
				"okf/notes/r.md": "---\ntype: Note\n---\n\n# R\n\n[a](decisions/q.md)\n",
			};
			const sandbox = yield* seed("okfit-validate-fix-lines-", seeded);
			const before = yield* read(sandbox, "okf/decisions/q.md");
			const dry = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--dry-run"], sandbox);
			const lines = (stdout: string) =>
				stdout.split("\n").filter((l) => l.startsWith("  ") || /^(Would fix|Fixed) \d/.test(l));
			assert.deepStrictEqual(lines(dry.stdout), [
				"Would fix 4 finding(s) in 3 file(s)",
				"  decisions/q.md: root-relative-path (2)",
				"  index.md: okf-version",
				"  notes/r.md: root-relative-path",
			]);
			assert.strictEqual(yield* read(sandbox, "okf/decisions/q.md"), before);
			const real = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.deepStrictEqual(lines(real.stdout), [
				"Fixed 4 finding(s) in 3 file(s)",
				"  decisions/q.md: root-relative-path (2)",
				"  index.md: okf-version",
				"  notes/r.md: root-relative-path",
			]);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("an unclosed root index is refused with its reason", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-unclosed-index-", {
				...V02_PROJECT,
				"okf/index.md": "---\ntitle: x\n\n# X\n",
			});
			const run = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.include(
				run.stdout,
				"refused: index.md: the root index frontmatter opens with --- but never closes; add the closing --- by hand, then fix again",
			);
			const summary = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.include(summary.stderr, "1 refused by --fix");
			// #512: one message, naming the fix, not three
			assert.include(summary.stdout, "frontmatter-unclosed");
			assert.include(
				summary.stdout,
				"okf_version cannot be read, because the root index.md frontmatter opens with --- but never closes; add the closing --- by hand, then validate again",
			);
			assert.notInclude(summary.stdout, "missing-index");
			assert.notInclude(summary.stdout, "okf_version is not declared");
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("a positional target narrows --fix: another file is refused, the computation alone changes", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-narrow-");
			const before = yield* read(sandbox, COMPUTATION);
			const index = yield* read(sandbox, "okf/index.md");
			const other = yield* runOkfit(["validate", "--target", "0.3", "--fix", "okf/index.md"], sandbox);
			assert.strictEqual(other.exitCode, 0);
			assert.include(other.stdout, "refused: index.md: 2 reference(s) still resolve only from the bundle root");
			assert.strictEqual(yield* read(sandbox, "okf/index.md"), index);
			assert.strictEqual(yield* read(sandbox, COMPUTATION), before);
			// control: naming the computation writes it, and only it
			const mine = yield* runOkfit(["validate", "--target", "0.3", "--fix", COMPUTATION], sandbox);
			assert.strictEqual(mine.exitCode, 0);
			assert.include(mine.stdout, "Fixed 2 finding(s) in 1 file(s)");
			assert.strictEqual(yield* read(sandbox, COMPUTATION), V03_PROJECT[COMPUTATION]);
			assert.strictEqual(yield* read(sandbox, "okf/index.md"), index);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("a positional target that does not exist fails as it does without --fix, and writes nothing", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-missing-target-");
			const before = yield* read(sandbox, COMPUTATION);
			const plain = yield* runOkfit(["validate", "--target", "0.3", "okf/nope.md"], sandbox);
			const fix = yield* runOkfit(["validate", "--target", "0.3", "--fix", "okf/nope.md"], sandbox);
			assert.notStrictEqual(plain.exitCode, 0);
			assert.strictEqual(fix.exitCode, plain.exitCode);
			assert.strictEqual(yield* read(sandbox, COMPUTATION), before);
			assert.strictEqual(yield* read(sandbox, "okf/index.md"), V02_PROJECT["okf/index.md"]);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect(
		"lists a concept whose current human integrity the fix changed under Integrity drifted, and in JSON drifts",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* seed("okfit-validate-drift-");
				// Build a digest-bound human verification without running okfit verify: probe the bundle for digests.
				const trusted = (text: string, body: string, content: string) =>
					text.replace(
						"runtime: sql\n",
						`runtime: sql\ngenerated:\n  by: okfit/test\n  at: 2026-02-01T00:00:00Z\nverified:\n  - by: human:a\n    at: 2026-03-01T00:00:00Z\n${
							body === ""
								? ""
								: `x-okfit-integrity:\n  generated:\n    body: ${body}\n  verified:\n    by: human:a\n    at: 2026-03-01T00:00:00Z\n    content: ${content}\n`
						}`,
					);
				const file = join(sandbox.cwd, COMPUTATION);
				const text = V02_PROJECT[COMPUTATION] as string;
				yield* Effect.promise(() => writeFile(file, trusted(text, "", "")));
				const bundle = yield* Bundle.load({ root: join(sandbox.cwd, "okf") });
				const concept = bundle.concepts.get(Option.getOrThrow(ConceptId.fromPath("computations/revenue-ytd.md")));
				if (concept === undefined) return yield* Effect.die("probe concept missing");
				const body = yield* Derivation.bodyDigest(concept.document.source);
				const content = yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source);
				yield* Effect.promise(() => writeFile(file, trusted(text, body, content)));

				const human = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--dry-run"], sandbox);
				assert.strictEqual(human.exitCode, 0);
				assert.include(human.stdout, "Integrity drifted (re-verify with okfit verify): computations/revenue-ytd");
				const jsonRun = yield* runOkfit(
					["validate", "--target", "0.3", "--fix", "--dry-run", "--format", "json"],
					sandbox,
				);
				const parsed = JSON.parse(jsonRun.stdout) as { fixes: { drifts: string[] } };
				assert.deepStrictEqual(parsed.fixes.drifts, ["computations/revenue-ytd"]);
				// control: a sandbox with no recorded verification lists no drift
				const plain = yield* seed("okfit-validate-nodrift-");
				const none = yield* runOkfit(["validate", "--target", "0.3", "--fix", "--dry-run"], plain);
				assert.notInclude(none.stdout, "Integrity drifted");
			}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--fix on a bundle whose config says 0.2 shows config-okf-version-stale after the fix", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-config-version-stale-", {
				...V02_PROJECT,
				".config/okfit.toml": 'okf_version = "0.2"\n\n[types.Metric]\n\n[types."Attested Computation"]\n',
			});
			const before = yield* runOkfit(["validate"], sandbox);
			assert.notInclude(before.stdout, "config-okf-version-stale");
			const fixed = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.include(fixed.stdout, "Fixed");
			assert.include(fixed.stdout, "config-okf-version-stale");
			assert.match(yield* read(sandbox, "okf/index.md"), /okf_version: ["']0\.3["']/);
			assert.include(yield* read(sandbox, ".config/okfit.toml"), 'okf_version = "0.2"');
			const after = yield* runOkfit(["validate"], sandbox);
			assert.include(after.stdout, "config-okf-version-stale");
			assert.include(
				after.stdout,
				`okf_version in ${join(sandbox.cwd, ".config", "okfit.toml")} is "0.2", but the bundle-root index.md declares "0.3"`,
			);
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("--target 0.3 lists a README link and --fix roots it", () =>
		Effect.gen(function* () {
			const sandbox = yield* seed("okfit-validate-readme-", NON_CONCEPT_LINKS_PROJECT);
			const listed = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.include(listed.stdout, "sub/README.md");
			assert.include(listed.stdout, "sub/log.md");
			assert.include(listed.stdout, "sub/index.md");
			const fixed = yield* runOkfit(["validate", "--target", "0.3", "--fix"], sandbox);
			assert.include(fixed.stdout, "Fixed 5 finding(s) in 5 file(s)");
			assert.include(yield* read(sandbox, "okf/sub/README.md"), "[a](/a.md)");
			assert.include(yield* read(sandbox, "okf/sub/log.md"), "[a](/a.md)");
			assert.include(yield* read(sandbox, "okf/index.md"), 'okf_version: "0.3"');
			const after = yield* runOkfit(["validate", "--target", "0.3"], sandbox);
			assert.include(after.stderr, "OKF 0.3: 0 finding(s)");
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: a parse-time usage error under --format json (#485)", () => {
	const usage = (args: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			return yield* runOkfit(args, sandbox);
		}).pipe(Effect.provide(TestPlatform));

	it.effect("--only bogus --format json prints one error envelope on stdout and exits 64", () =>
		Effect.gen(function* () {
			const result = yield* usage(["validate", "--only", "bogus", "--format", "json"]);
			assert.strictEqual(result.exitCode, 64);
			assert.strictEqual(result.stdout.trimEnd().split("\n").length, 1);
			const envelope = JSON.parse(result.stdout) as {
				readonly exit_code: number;
				readonly error: { readonly tag: string; readonly message: string };
			};
			assert.strictEqual(envelope.exit_code, 64);
			assert.strictEqual(envelope.error.tag, "InvalidValue");
			assert.include(envelope.error.message, "--only");
			assert.include(result.stderr, "Invalid value for flag --only");
		}),
	);

	it.effect("--only bogus without --format json leaves stdout empty", () =>
		Effect.gen(function* () {
			const result = yield* usage(["validate", "--only", "bogus"]);
			assert.strictEqual(result.exitCode, 64);
			assert.strictEqual(result.stdout, "");
			assert.include(result.stderr, "Invalid value for flag --only");
		}),
	);

	it.effect("the envelope is the single compact line, keys in contract order, byte for byte", () =>
		Effect.gen(function* () {
			const result = yield* usage(["validate", "--bogus", "--format", "json"]);
			assert.strictEqual(result.exitCode, 64);
			const envelope = JSON.parse(result.stdout) as {
				readonly okfit_version: string;
				readonly error: { readonly message: string };
			};
			assert.match(envelope.okfit_version, /^\d+\.\d+\.\d+/);
			assert.strictEqual(
				result.stdout,
				`${JSON.stringify({
					schema: 1,
					okfit_version: envelope.okfit_version,
					engine_version: ENGINE_VERSION,
					distribution: null,
					exit_code: 64,
					error: { tag: "UnrecognizedOption", message: envelope.error.message },
				})}\n`,
			);
		}),
	);

	it.effect("an unknown flag under --format json gets the envelope too", () =>
		Effect.gen(function* () {
			const result = yield* usage(["validate", "--bogus", "--format", "json"]);
			assert.strictEqual(result.exitCode, 64);
			const envelope = JSON.parse(result.stdout) as { readonly error: { readonly tag: string } };
			assert.strictEqual(envelope.error.tag, "UnrecognizedOption");
		}),
	);
});

describe("okfit validate: config messages (#499, #501)", () => {
	const BAD_CONFIG =
		'[lint]\nmissing_index = "loud"\n\n[bundle]\npath = 3\n\n[lifecycle]\ndefault_stale_after = "soon"\n';

	it.effect("--format json carries every bad key in one error.message (#501)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-bad-keys-"));
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, { ...V02_PROJECT, "okfit.toml": BAD_CONFIG }));
			const result = yield* runOkfit(["validate", "--format", "json"], sandbox);
			assert.strictEqual(result.exitCode, 3);
			assert.strictEqual(result.stdout.trimEnd().split("\n").length, 1);
			const envelope = JSON.parse(result.stdout) as { readonly error: { readonly message: string } };
			for (const key of ["lint.missing_index", "bundle.path", "lifecycle.default_stale_after"]) {
				assert.include(envelope.error.message, key);
			}
		}).pipe(Effect.provide(TestPlatform)),
	);

	it.effect("the stale-version warning names the discovered file, and --config names that file (#499)", () =>
		Effect.gen(function* () {
			const config = 'okf_version = "0.3"\n\n[types.Metric]\n\n[types."Attested Computation"]\n';
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-stale-path-"));
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, { ...V02_PROJECT, "okfit.toml": config }));
			const discovered = join(sandbox.cwd, "okfit.toml");
			const first = yield* runOkfit(["validate"], sandbox);
			assert.include(first.stdout, `okf_version in ${discovered} is "0.3"`);
			yield* Effect.promise(() => writeFile(join(sandbox.cwd, "other.toml"), config, "utf8"));
			const other = join(sandbox.cwd, "other.toml");
			const second = yield* runOkfit(["validate", "--config", other], sandbox);
			assert.include(second.stdout, `okf_version in ${other} is "0.3"`);
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: the human error line carries every bad key (#501)", () => {
	it.effect("stderr names all three keys on one line", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-bad-keys-human-"));
			const bad = '[lint]\nmissing_index = "loud"\n\n[bundle]\npath = 3\n\n[lifecycle]\ndefault_stale_after = "soon"\n';
			yield* Effect.promise(() => writeSeedInto(sandbox.cwd, { ...V02_PROJECT, "okfit.toml": bad }));
			const result = yield* runOkfit(["validate"], sandbox);
			assert.strictEqual(result.exitCode, 3);
			const lines = result.stderr.split("\n").filter((l) => l.startsWith("error:"));
			assert.strictEqual(lines.length, 1);
			for (const key of ["lint.missing_index", "bundle.path", "lifecycle.default_stale_after"]) {
				assert.include(lines[0], key);
			}
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: a directory link out of the bundle and a dangling link (#458)", () => {
	const concept = (title: string): string => `---\ntype: Note\ntitle: ${title}\n---\n\n# ${title}\n`;
	it.effect(
		"warns on external and gone, is silent on an in-bundle directory link, and reads nothing under external",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-dirlink-"));
				const init = yield* runOkfit(["init"], sandbox);
				assert.strictEqual(init.exitCode, 0);
				const bundle = join(sandbox.cwd, "okf");
				const outside = join(sandbox.cwd, "outside");
				yield* Effect.promise(async () => {
					await writeFileDeep(join(outside, "secret.md"), concept("Secret"));
					await writeFileDeep(join(bundle, "decisions", "in.md"), concept("In"));
					await symlink(outside, join(bundle, "external"));
					await symlink(join(sandbox.cwd, "nowhere"), join(bundle, "gone"));
					await symlink(join(bundle, "decisions"), join(bundle, "alias"));
					// an in-bundle link to a directory link that leaves the bundle
					await symlink(join(bundle, "external"), join(bundle, "hop"));
				});
				const json = yield* runOkfit(["validate", "--format", "json"], sandbox);
				const body = JSON.parse(json.stdout) as {
					summary: { concepts: number };
					diagnostics: Array<{ code: string; file: string; message: string }>;
				};
				const escapes = body.diagnostics.filter((d) => d.code === "symlink-escape");
				assert.deepStrictEqual(escapes.map((d) => d.file.split("/").pop()).sort(), ["external", "gone", "hop"]);
				const human = yield* runOkfit(["validate"], sandbox);
				assert.include(
					human.stdout,
					"external warning symlink-escape symbolic link to a directory resolves outside the bundle root; nothing under it is read or part of the bundle",
				);
				assert.include(
					human.stdout,
					"gone warning symlink-escape symbolic link could not be resolved, so it cannot be shown to stay inside the bundle root; it is not read and not part of the bundle",
				);
				assert.notInclude(human.stdout, "alias");
				assert.notInclude(human.stdout, "secret");
				// project (from init) and decisions/in: the concept under external/ is not counted
				assert.strictEqual(body.summary.concepts, 2);
				const dry = yield* runOkfit(["sync", "--dry-run"], sandbox);
				assert.notInclude(dry.stdout, "external/");
				assert.notInclude(dry.stdout, "hop/");
			}).pipe(Effect.provide(TestPlatform)),
	);
	// root ignores mode bits, so the locked directory would stay readable and the case would prove nothing
	it.effect.skipIf(process.getuid?.() === 0)("reports a link into a mode-000 directory and a link loop", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-unresolvable-"));
			const init = yield* runOkfit(["init"], sandbox);
			assert.strictEqual(init.exitCode, 0);
			const bundle = join(sandbox.cwd, "okf");
			const locked = join(sandbox.cwd, "locked");
			yield* Effect.promise(async () => {
				await writeFileDeep(join(locked, "target.md"), concept("Target"));
				await symlink(join(locked, "target.md"), join(bundle, "peek.md"));
				await symlink(join(bundle, "loop"), join(bundle, "loop"));
				await chmod(locked, 0o000);
			});
			yield* Effect.gen(function* () {
				const json = yield* runOkfit(["validate", "--format", "json"], sandbox);
				const body = JSON.parse(json.stdout) as { diagnostics: Array<{ code: string; file: string }> };
				const files = body.diagnostics
					.filter((d) => d.code === "symlink-escape")
					.map((d) => d.file.split("/").pop())
					.sort();
				assert.deepStrictEqual(files, ["loop", "peek.md"]);
			}).pipe(Effect.ensuring(Effect.promise(() => chmod(locked, 0o755))));
		}).pipe(Effect.provide(TestPlatform)),
	);
});

describe("okfit validate: generated-missing reads the decoder (#466)", () => {
	it.effect("generated: {} is generated-missing beside entry-ignored", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-validate-genmissing-"));
			const init = yield* runOkfit(["init"], sandbox);
			assert.strictEqual(init.exitCode, 0);
			yield* Effect.promise(async () => {
				const configPath = join(sandbox.cwd, ".config", "okfit.toml");
				await writeFile(
					configPath,
					`${await readFile(configPath, "utf8")}\n[actors]\nagent = "okfit/claude-code"\n`,
					"utf8",
				);
				await writeFileDeep(
					join(sandbox.cwd, "okf", "decisions", "empty.md"),
					"---\ntype: Note\ngenerated: {}\n---\n\n# Empty\n",
				);
			});
			const run = yield* runOkfit(["validate"], sandbox);
			const lines = run.stdout.split("\n").filter((line) => line.includes("decisions/empty.md"));
			assert.isTrue(
				lines.some((line) => line.includes("entry-ignored")),
				run.stdout,
			);
			const missing = lines.filter((line) => line.includes("generated-missing"));
			assert.strictEqual(missing.length, 1, run.stdout);
			assert.include(missing[0], "set generated.by by hand");
			assert.include(missing[0], "okfit sync cannot fill in a block that is written");
		}).pipe(Effect.provide(TestPlatform)),
	);
});
