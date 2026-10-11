// Acceptance suite for `okfit context` (contract §9.5), spawning the built
// dist/dev bin (K-43) exactly as validate.e2e.test.ts does -- never
// Command.run in-process -- so every exit code and every byte of
// stdout/stderr is what a real invocation produces.
//
// No CLI-owned fixture (K-44): every case here copies
// packages/profiles/__test__/fixtures/software-project (a repo-shaped fixture whose bundle is okf/), the same constant
// validate.e2e.test.ts names CLEAN_FIXTURE.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CONFIG_SCHEMA_VERSION, OkfitConfig } from "@okfit/core";
import { contextEnvelope } from "@okfit/engine";
import { Profiles } from "@okfit/profiles";
import { Effect } from "effect";
import { humanContext } from "../../src/render/context.js";
import { copyFixtureInto, makeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";

const PROFILES_FIXTURES = resolve(import.meta.dirname, "..", "..", "..", "profiles", "__test__", "fixtures");
const CLEAN_FIXTURE = join(PROFILES_FIXTURES, "software-project");

/** Writes `contents` to `path`, creating parent directories as needed. */
const writeFileDeep = async (path: string, contents: string): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents, "utf8");
};

/**
 * The vocabulary `software-project` declares, rendered through the same
 * `contextEnvelope` the CLI uses, so the expected value tracks the profile
 * (sixteen types with their constraints, thirteen tags) instead of a hand copy
 * that drifts every time the profile grows. `OkfitConfig.merge` mirrors the
 * `DEFAULTS < profile` merge the CLI applies when no config file exists.
 */
const EXPECTED_VOCABULARY = contextEnvelope({
	projectRoot: "",
	bundleRoot: "",
	configPath: null,
	profile: "software-project",
	profileRequested: null,
	indexPath: "",
	indexExists: false,
	config: OkfitConfig.merge(OkfitConfig.DEFAULTS, Profiles.softwareProject.config),
});
const SOFTWARE_PROJECT_TYPES = EXPECTED_VOCABULARY.types;
const SOFTWARE_PROJECT_TAGS = EXPECTED_VOCABULARY.tags;
/** The human renderer's type block (bullets plus constraint lines), between the `types:` and `tags:` headers. */
const HUMAN_LINES = humanContext(EXPECTED_VOCABULARY);
const HUMAN_TYPE_LINES = HUMAN_LINES.slice(HUMAN_LINES.indexOf("types:") + 1, HUMAN_LINES.indexOf("tags:") - 1);

describe("okfit context: human format", () => {
	it.effect("prints the roots, profile, index.md status, and the full vocabulary", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));

			const result = yield* runOkfit(["context"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			const bundleRoot = join(sandbox.cwd, "okf");
			const expectedLines = [
				`project root: ${sandbox.cwd}`,
				`bundle root: ${bundleRoot}`,
				"config: (none)",
				"profile: software-project",
				`index.md: ${join(bundleRoot, "index.md")} (exists)`,
				"agent: (unset)",
				"",
				"types:",
				...HUMAN_TYPE_LINES,
				"",
				"tags:",
				...SOFTWARE_PROJECT_TAGS.map((t) => `  ${t.name}  ${t.description}`),
			];
			assert.strictEqual(result.stdout, `${expectedLines.join("\n")}\n`);
			assert.strictEqual(result.stderr, "");
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit context --format json", () => {
	it.effect(
		"deep-equals a fully specified envelope: schema 1, config_path null, the profile's types with constraints, and its tags",
		() =>
			Effect.gen(function* () {
				const sandbox = yield* Effect.promise(() => makeSandbox());
				yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));

				const result = yield* runOkfit(["context", "--format", "json"], sandbox);

				assert.strictEqual(result.exitCode, 0);
				assert.strictEqual(result.stderr, "");
				const bundleRoot = join(sandbox.cwd, "okf");
				assert.deepStrictEqual(JSON.parse(result.stdout), {
					schema: 1,
					config_schema_version: CONFIG_SCHEMA_VERSION,
					project_root: sandbox.cwd,
					bundle_root: bundleRoot,
					config_path: null,
					profile: "software-project",
					profile_requested: null,
					index_path: join(bundleRoot, "index.md"),
					index_exists: true,
					actors: { agent: null },
					types: SOFTWARE_PROJECT_TYPES,
					tags: SOFTWARE_PROJECT_TAGS,
					trust: null,
				});
			}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("index_exists is false in a sandbox with a config but no index.md", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			// A bundle with content but deliberately no index.md. Every entry
			// under packages/profiles/__test__/fixtures/bad/ ships its own
			// bundle-root index.md (confirmed this session by `find`), so none of
			// them can stand in for "no index.md" here -- write one concept file
			// directly instead (context never validates it either way).
			yield* Effect.promise(() =>
				writeFileDeep(join(sandbox.cwd, "okf", "modules", "example.md"), "---\ntype: Module\n---\n\n# Example\n"),
			);
			yield* Effect.promise(() => writeFileDeep(join(sandbox.cwd, "okfit.toml"), `[bundle]\npath = "okf"\n`));

			const result = yield* runOkfit(["context", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, "");
			const envelope = JSON.parse(result.stdout) as { readonly index_exists: boolean; readonly config_path: string };
			assert.isFalse(envelope.index_exists);
			assert.strictEqual(envelope.config_path, join(sandbox.cwd, "okfit.toml"));
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit context: no config anywhere", () => {
	it.effect("exits 0, config_path null, profile software-project (contract §8.5)", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));

			const result = yield* runOkfit(["context", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			const envelope = JSON.parse(result.stdout) as {
				readonly config_path: unknown;
				readonly profile: unknown;
				readonly profile_requested: unknown;
			};
			assert.isNull(envelope.config_path);
			assert.strictEqual(envelope.profile, "software-project");
			// Important 1: profile_requested is null only when no config file was found at all.
			assert.isNull(envelope.profile_requested);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit context: --config naming a missing path", () => {
	it.effect("exit 3, stderr names the path, stdout carries the K-22 error envelope", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const missingConfig = join(sandbox.cwd, "does-not-exist.toml");

			const result = yield* runOkfit(["context", "--format", "json", "--config", missingConfig], sandbox);

			assert.strictEqual(result.exitCode, 3);
			assert.isTrue(result.stderr.includes(`error: config path not found: ${missingConfig}`));
			const envelope = JSON.parse(result.stdout) as {
				readonly schema: number;
				readonly okfit_version: string;
				readonly exit_code: number;
				readonly error: { readonly tag: string; readonly message: string };
			};
			assert.strictEqual(envelope.schema, 1);
			assert.match(String(envelope.okfit_version), /^\d+\.\d+\.\d+/);
			assert.strictEqual(envelope.exit_code, 3);
			assert.strictEqual(envelope.error.tag, "ConfigPathNotFoundError");
			assert.strictEqual(envelope.error.message, `config path not found: ${missingConfig}`);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit context: malformed config", () => {
	it.effect("exit 3, error.tag ConfigMalformedError, stderr names the file", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			const badConfigPath = join(sandbox.cwd, "bad.toml");
			yield* Effect.promise(() => writeFileDeep(badConfigPath, `[bundle\npath = "okf"\n`));

			const result = yield* runOkfit(["context", "--format", "json", "--config", badConfigPath], sandbox);

			assert.strictEqual(result.exitCode, 3);
			// Same pinned message validate.e2e.test.ts's own malformed-TOML case
			// asserts: @effected/config-file's ConfigCodecError carries no path
			// of its own, so @okfit/engine's config/layer.ts#provideConfig wraps it with the
			// KNOWN --config path (K-46 fix round 1), reused unchanged by context.
			assert.strictEqual(result.stderr, `error: malformed config ${badConfigPath}: toml parse failed\n`);
			const envelope = JSON.parse(result.stdout) as {
				readonly schema: number;
				readonly okfit_version: string;
				readonly exit_code: number;
				readonly error: { readonly tag: string; readonly message: string };
			};
			assert.strictEqual(envelope.schema, 1);
			assert.match(String(envelope.okfit_version), /^\d+\.\d+\.\d+/);
			assert.strictEqual(envelope.exit_code, 3);
			assert.strictEqual(envelope.error.tag, "ConfigMalformedError");
			assert.strictEqual(envelope.error.message, `malformed config ${badConfigPath}: toml parse failed`);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit context: unknown profile", () => {
	it.effect("stderr is exactly the K-4 warning; stdout still parses as one envelope with profile null", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox());
			yield* Effect.promise(() => copyFixtureInto(CLEAN_FIXTURE, sandbox.cwd));
			yield* Effect.promise(() =>
				writeFileDeep(join(sandbox.cwd, "okfit.toml"), `[bundle]\nprofile = "not-a-real-profile"\n`),
			);

			const result = yield* runOkfit(["context", "--format", "json"], sandbox);

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stderr, 'warning: unknown profile "not-a-real-profile"; continuing with defaults\n');
			const envelope = JSON.parse(result.stdout) as {
				readonly profile: unknown;
				readonly profile_requested: unknown;
				readonly types: ReadonlyArray<unknown>;
			};
			assert.isNull(envelope.profile);
			// Important 1: profile_requested still names what the config asked for.
			assert.strictEqual(envelope.profile_requested, "not-a-real-profile");
			// Falls to OkfitConfig.DEFAULTS alone: no profile's vocabulary is merged in.
			assert.deepStrictEqual(envelope.types, []);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});

describe("okfit context --trust", () => {
	const NOW = "2026-10-09T12:00:00Z";
	const concept = (name: string, extra = ""): string =>
		`---\ntype: Glossary\ndescription: ${name}.\nstatus: stable\n${extra}---\n\n# ${name}\n\nOriginal body.\n`;

	/** A bundle with one drifted, one stale and one plain unverified concept. */
	const driftedSandbox = async () => {
		const sandbox = await makeSandbox("okfit-context-trust-");
		const home = sandbox.env.HOME ?? "";
		const env = {
			...sandbox.env,
			PATH: process.env.PATH ?? "",
			NO_COLOR: "1",
			GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
			GIT_CONFIG_NOSYSTEM: "1",
			OKFIT_NOW: NOW,
		};
		await writeFile(join(home, ".gitconfig"), "[user]\n\tname = Ada Lovelace\n\temail = ada@example.com\n", "utf8");
		await writeFileDeep(join(sandbox.cwd, "okfit.toml"), `[bundle]\npath = "okf"\n`);
		const put = (rel: string, body: string) => writeFileDeep(join(sandbox.cwd, "okf", rel), body);
		await put("index.md", "# Index\n");
		await put("trust/drifted.md", concept("Drifted"));
		await put("trust/stale.md", concept("Stale", "stale_after: 2020-01-01T00:00:00Z\n"));
		await put("trust/plain.md", concept("Plain"));
		const verify = await Effect.runPromise(
			runOkfit(["verify", "trust/drifted", "--format", "json"], { cwd: sandbox.cwd, env }).pipe(
				Effect.provide(NodeServices.layer),
			),
		);
		assert.strictEqual(verify.exitCode, 0, verify.stderr);
		const file = join(sandbox.cwd, "okf", "trust", "drifted.md");
		await writeFile(file, (await readFile(file, "utf8")).replace("Original body.", "Edited body."), "utf8");
		return { sandbox, env };
	};

	it.effect("--trust --format json carries counts and ids; the same run without the flag has trust null", () =>
		Effect.gen(function* () {
			const { sandbox, env } = yield* Effect.promise(driftedSandbox);
			const withTrust = yield* runOkfit(["context", "--format", "json", "--trust"], { cwd: sandbox.cwd, env });
			assert.strictEqual(withTrust.exitCode, 0, withTrust.stderr);
			assert.deepStrictEqual((JSON.parse(withTrust.stdout) as { trust: unknown }).trust, {
				concepts: 3,
				drifted: 1,
				stale: 1,
				unverified: 2,
				drifted_ids: ["trust/drifted"],
				stale_ids: ["trust/stale"],
			});
			const without = yield* runOkfit(["context", "--format", "json"], { cwd: sandbox.cwd, env });
			assert.strictEqual(without.exitCode, 0);
			assert.isNull((JSON.parse(without.stdout) as { trust: unknown }).trust);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("human output adds the trust, drifted and stale lines only with the flag", () =>
		Effect.gen(function* () {
			const { sandbox, env } = yield* Effect.promise(driftedSandbox);
			const withTrust = yield* runOkfit(["context", "--trust"], { cwd: sandbox.cwd, env });
			const lines = withTrust.stdout.split("\n");
			assert.include(lines, "trust: 1 drifted, 1 stale, 2 unverified (of 3)");
			assert.include(lines, "drifted: trust/drifted");
			assert.isTrue(lines.some((l) => l.startsWith("drift: ") && l.includes("okfit query list --drifted")));
			assert.include(lines, "stale: trust/stale");
			const without = yield* runOkfit(["context"], { cwd: sandbox.cwd, env });
			assert.notInclude(without.stdout, "trust:");
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	it.effect("--trust in a project with no bundle succeeds with trust null, like plain context", () =>
		Effect.gen(function* () {
			const sandbox = yield* Effect.promise(() => makeSandbox("okfit-context-trust-empty-"));
			const env = { ...sandbox.env, PATH: process.env.PATH ?? "", NO_COLOR: "1", OKFIT_NOW: NOW };
			const result = yield* runOkfit(["context", "--trust", "--format", "json"], { cwd: sandbox.cwd, env });
			assert.strictEqual(result.exitCode, 0, result.stderr);
			const envelope = JSON.parse(result.stdout) as { trust: unknown; index_exists: boolean };
			assert.isFalse(envelope.index_exists);
			assert.isNull(envelope.trust);
		}).pipe(Effect.provide(NodeServices.layer)),
	);
});
