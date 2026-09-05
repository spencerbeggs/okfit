// Acceptance suite for `okfit validate` (contract §6.2 `validate-*` rows,
// §6.2 `config-discovery.e2e.test.ts`'s matrix, and the K-9 no-state-files
// check), all folded into one file per this group's brief. Spawns the built
// dist/dev bin (K-43) — never Command.run in-process — so every exit code
// and every byte of stdout/stderr is what a real invocation produces.
//
// Fixture exception (K-44, recorded per decision 3 above): the OKFIT_NOW/
// stale case patches a copy of the clean software-project fixture with a
// `stale_after` field, because no shipped bad-bundle fixture sets one.
// Every other fixture here is a plain copy of an existing core/profiles
// fixture — no CLI-owned duplicate category.

import { readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import cliPackageJson from "../../package.json" with { type: "json" };
import { copyFixtureInto, makeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const CORE_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "core", "__test__", "fixtures");
const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");

const CLEAN_FIXTURE = join(PROFILES_FIXTURES, "software-project");
const PROFILE_BAD_FIXTURE = join(PROFILES_FIXTURES, "bad", "no-project");
const LINT_BAD_FIXTURE = join(PROFILES_FIXTURES, "bad", "module-no-kind");
const CONFORMANCE_BAD_FIXTURE = join(CORE_FIXTURES, "bad", "c-frontmatter-missing");

const CLI_VERSION = (cliPackageJson as { readonly version: string }).version;

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
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout, "");
			// Captured this session: Bundle.load over the clean fixture with the
			// default merge (DEFAULTS < software-project, no file config) reports
			// zero conformance/lint/profile diagnostics and 6 concepts.
			assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 6 concepts (okf)\n");

			assertNoStateFiles(sandbox.env);
		}).pipe(Effect.provide(NodeServices.layer)),
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
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit validate: conformance beats a co-occurring profile error", () => {
	it.effect("a frontmatter-missing concept: exit 2, sorted stdout, both diagnostics counted", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CONFORMANCE_BAD_FIXTURE, join(sandbox.cwd, "okf")));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 2);
			// Captured this session: this fixture has no project.md, so it also
			// carries a "project-missing" profile error (file "") alongside core's
			// conformance "frontmatter-missing" on no-front.md — K-17 sorts the
			// bundle-level ("") entry first; conformance (exit 2) still beats the
			// co-occurring profile error (tier 1). concepts=0.
			assert.strictEqual(
				result.stdout,
				"(bundle) error project-missing No Project concept in the bundle; software-project expects exactly one at the bundle root (project.md)\n" +
					"no-front.md error frontmatter-missing concept files must start with a --- frontmatter block\n",
			);
			assert.strictEqual(result.stderr, "2 errors, 0 warnings, 0 info in 0 concepts (okf)\n");
		}).pipe(Effect.provide(NodeServices.layer)),
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
			assert.deepStrictEqual(JSON.parse(result.stdout), {
				schema: 1,
				okfit_version: CLI_VERSION,
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
						range: { offset: 0, length: 118, line: 0, character: 0 },
					},
				],
			});
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("an unknown profile: stderr is exactly the K-4 warning, stdout parses as one envelope", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));
			yield* Effect.promise(() =>
				writeFileDeep(join(sandbox.cwd, "okfit.config.toml"), `[bundle]\nprofile = "not-a-real-profile"\n`),
			);

			const result = yield* runOkfit(["validate", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, 'warning: unknown profile "not-a-real-profile"; continuing with defaults\n');
			const bundleRoot = join(sandbox.cwd, "okf");
			assert.deepStrictEqual(JSON.parse(result.stdout), {
				schema: 1,
				okfit_version: CLI_VERSION,
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
					concepts: 6,
				},
				diagnostics: [],
			});
		}).pipe(Effect.provide(NodeServices.layer)),
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
				readonly exit_code: number;
				readonly error: { readonly tag: string; readonly message: string };
			};
			assert.strictEqual(envelope.schema, 1);
			assert.strictEqual(envelope.okfit_version, CLI_VERSION);
			assert.strictEqual(envelope.exit_code, 3);
			assert.strictEqual(envelope.error.tag, "ConfigPathNotFoundError");
			assert.strictEqual(envelope.error.message, `config path not found: ${missingConfig}`);
			assert.isTrue(result.stderr.includes(`error: config path not found: ${missingConfig}`));
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit validate: config discovery", () => {
	it.effect("finds .config/okfit/config.toml two directories up (K-10)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, ".config", "okfit", "config.toml"), CONFIG_TOML));
			const deepCwd = join(sandbox.cwd, "sub", "subsub");
			yield* Effect.promise(() => mkdir(deepCwd, { recursive: true }));

			const result = yield* runOkfit(["validate"], { ...sandbox, cwd: deepCwd });

			assert.strictEqual(result.exitCode, 0);
			// The anchor is 3 up from `.config/okfit/config.toml` — sandbox.cwd — so
			// the bundle root is `sandbox.cwd/okf`. Contract §3.3/K-51 renders a path
			// relative to cwd only when it is UNDER cwd; `sandbox.cwd/okf` is not
			// under `deepCwd` (it is two levels above deepCwd's own parent), so
			// `renderRoot` correctly falls back to the absolute path here — verified
			// against `commands/validate.ts`'s own `renderRoot` and the contract's
			// literal K-51 text, not the brief's original "../../okf" expectation,
			// which this test corrects (see task report for the discrepancy).
			assert.strictEqual(result.stderr, `0 errors, 0 warnings, 0 info in 6 concepts (${join(sandbox.cwd, "okf")})\n`);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("finds okfit.config.toml alone (K-10)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, "okfit.config.toml"), CONFIG_TOML));

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "0 errors, 0 warnings, 0 info in 6 concepts (okf)\n");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("explicit --config short-circuits discovery and anchors on its own directory (K-1, K-10, K-12)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const elsewhere = join(sandbox.cwd, "..", "elsewhere");
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(elsewhere, "okf")));
			const explicitConfigPath = join(elsewhere, "myconfig.toml");
			// A bogus profile of its own (distinct from the two competitors
			// below) so the K-4 warning it produces is itself discriminating:
			// only ITS name may appear on stderr.
			yield* Effect.promise(() =>
				writeFileDeep(explicitConfigPath, `[bundle]\npath = "okf"\nprofile = "explicit-config-profile"\n`),
			);

			// K-10/K-11 competitors: a project-local `okfit.config.toml` at the
			// sandbox cwd AND an `$XDG_CONFIG_HOME/okfit/config.toml` fallback,
			// each naming its own bogus profile. If `--config` did not actually
			// short-circuit discovery, one of these would win instead and its
			// (different) bogus-profile warning would appear on stderr.
			yield* Effect.promise(() =>
				writeFileDeep(join(sandbox.cwd, "okfit.config.toml"), `[bundle]\nprofile = "cwd-discovery-profile"\n`),
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
					`0 errors, 0 warnings, 0 info in 6 concepts (${join(elsewhere, "okf")})\n`,
			);
			assert.isFalse(result.stderr.includes("cwd-discovery-profile"));
			assert.isFalse(result.stderr.includes("xdg-discovery-profile"));
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("missing --config: exit 3 with the exact K-51 message", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const missingConfig = join(sandbox.cwd, "does-not-exist.toml");

			const result = yield* runOkfit(["validate", "--config", missingConfig], sandbox);

			assert.strictEqual(result.exitCode, 3);
			assert.strictEqual(result.stdout, "");
			assert.isTrue(result.stderr.includes(`error: config path not found: ${missingConfig}\n`));
		}).pipe(Effect.provide(NodeServices.layer)),
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
			// failed`) — `config/layer.ts#provideConfig` now wraps it into
			// `ConfigMalformedError` with the KNOWN `--config` path (K-46 fix
			// round 1), so this asserts the exact, pinned message the wrapped
			// error renders (captured this session by running the CLI directly
			// against this fixture — see task report).
			assert.strictEqual(result.stderr, `error: malformed config ${badConfigPath}: toml parse failed\n`);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect(
		"discovery branch: a schema-invalid discovered config also names the file, when the library's own path is known (K-46 fix round 1)",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* Effect.promise(() => makeSandbox());
				const configPath = join(sandbox.cwd, "okfit.config.toml");
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
				assert.strictEqual(
					result.stderr,
					`error: malformed config ${configPath}: Config validation failed at "${configPath}"\n`,
				);
			}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("unknown profile: warning on stderr, continues with defaults (K-4)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));
			yield* Effect.promise(() =>
				writeFileDeep(join(sandbox.cwd, "okfit.config.toml"), `[bundle]\nprofile = "not-a-real-profile"\n`),
			);

			const result = yield* runOkfit(["validate"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.isTrue(
				result.stderr.startsWith('warning: unknown profile "not-a-real-profile"; continuing with defaults\n'),
			);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("XDG_CONFIG_HOME fallback is read when no project-local config exists (K-11)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, join(sandbox.cwd, "okf")));
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
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit validate: OKFIT_NOW", () => {
	it.effect("makes a stale-after diagnostic deterministic regardless of the wall clock (K-47)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const bundleRoot = join(sandbox.cwd, "okf");
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, bundleRoot));
			// Patch a copy of the clean fixture's modules/core.md with a stale_after
			// in the past (decision 3): no shipped bad-bundle fixture sets one.
			const concept = join(bundleRoot, "modules", "core.md");
			const original = yield* Effect.promise(() => readFile(concept, "utf8"));
			yield* Effect.promise(() =>
				writeFile(
					concept,
					original.replace("tags: [architecture]\n---", "tags: [architecture]\nstale_after: 2025-01-01T00:00:00Z\n---"),
					"utf8",
				),
			);

			const before = yield* runOkfit(["validate"], {
				...sandbox,
				env: { ...sandbox.env, OKFIT_NOW: "2024-01-01T00:00:00Z" },
			});
			assert.strictEqual(before.exitCode, 0);
			assert.strictEqual(before.stdout, "");

			const after = yield* runOkfit(["validate"], {
				...sandbox,
				env: { ...sandbox.env, OKFIT_NOW: "2026-01-01T00:00:00Z" },
			});
			assert.strictEqual(after.exitCode, 0);
			// Captured this session: severity "info" (DEFAULT_LINT's stale: "info"),
			// so the exit code never moves; only the diagnostic's presence does.
			assert.strictEqual(
				after.stdout,
				"modules/core.md:1:1 info stale Concept is stale since 2025-01-01T00:00:00.000Z\n",
			);
			assert.strictEqual(after.stderr, "0 errors, 0 warnings, 1 info in 6 concepts (okf)\n");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
