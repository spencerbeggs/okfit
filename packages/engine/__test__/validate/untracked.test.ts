import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { LsFilesEntry } from "@effected/git";
import { Git } from "@effected/git";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { MemoryFileSystem } from "@effected/memfs";
import { Concept, ConceptId, LoadedBundle, LoadedConcept, OkfitConfig } from "@okfit/core";
import { Effect, FileSystem, Layer, Option, Result } from "effect";
import { lintUntrackedResources } from "../../src/validate/untracked.js";
import { denyAccess, seedPlatform } from "../utils/bundle.js";
import { TestPlatform } from "../utils/platform.js";

const platform = Git.layer.pipe(Layer.provideMerge(TestPlatform));
const FRONTMATTER_OPTIONS = MarkdownParseOptions.make({ frontmatter: true });

const sh = (cwd: string, ...args: Array<string>): void => {
	execFileSync("git", args, {
		cwd,
		stdio: "ignore",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_SYSTEM: "/dev/null",
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@example.com",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@example.com",
		},
	});
};

const put = async (root: string, rel: string, text = "x\n"): Promise<void> => {
	await mkdir(dirname(join(root, rel)), { recursive: true });
	await writeFile(join(root, rel), text);
};

const conceptWith = (resources: ReadonlyArray<string>): LoadedConcept =>
	LoadedConcept.make({
		id: Option.getOrThrow(ConceptId.normalize("thing.md")),
		path: "thing.md",
		frontmatter: Concept.make({
			type: "Module",
			extensions: {},
			raw: {},
			sources: resources.map((resource) => ({ resource })),
		}),
		document: Result.getOrThrow(MarkdownDocument.parseResult("", FRONTMATTER_OPTIONS)),
		computationBody: Option.none(),
	});

const bundleAt = (root: string, concept: LoadedConcept): LoadedBundle =>
	LoadedBundle.make({
		root,
		files: [concept.path],
		directories: [""],
		concepts: new Map([[concept.id, concept]]),
		indexes: new Map(),
		logs: new Map(),
		diagnostics: [],
	});

/** A temp dir, optionally a git repo with a bundle at `okf/`; cleaned up after. */
const withRepo = <A, E, R>(
	init: boolean,
	setup: (repo: string) => Promise<void>,
	body: (repo: string) => Effect.Effect<A, E, R>,
) =>
	Effect.acquireUseRelease(
		Effect.promise(async () => {
			const repo = await realpath(await mkdtemp(join(tmpdir(), "okfit-untracked-")));
			if (init) sh(repo, "init", "-q");
			await setup(repo);
			return repo;
		}),
		body,
		(repo) => Effect.promise(() => rm(repo, { recursive: true, force: true })),
	);

const lint = (repo: string, ...resources: Array<string>) =>
	lintUntrackedResources(bundleAt(join(repo, "okf"), conceptWith(resources)), OkfitConfig.DEFAULTS, repo).pipe(
		Effect.provide(platform),
	);

const summary = (ds: ReadonlyArray<{ code: string; severity: string }>) => ds.map((d) => `${d.code}:${d.severity}`);

describe("lintUntrackedResources (issue #279)", () => {
	it.effect(
		"flags a gitignored file as resource-ignored (error) and an untracked one as resource-untracked (warn)",
		() =>
			withRepo(
				true,
				async (repo) => {
					await put(repo, ".gitignore", "secret/\n");
					await put(repo, "secret/plan.md");
					await put(repo, "new.md");
					await put(repo, "kept.md");
					await put(repo, "okf/thing.md");
					sh(repo, "add", ".gitignore", "kept.md");
					sh(repo, "commit", "-qm", "init");
				},
				(repo) =>
					Effect.gen(function* () {
						const ds = yield* lint(repo, "../secret/plan.md", "../new.md", "../kept.md");
						assert.deepStrictEqual(summary(ds), ["resource-ignored:error", "resource-untracked:warning"]);
						assert.strictEqual(ds[0]?.file, "thing.md");
					}),
			),
	);

	it.effect("does not flag an untracked file once it is staged", () =>
		withRepo(
			true,
			async (repo) => {
				await put(repo, "new.md");
				await put(repo, "okf/thing.md");
				sh(repo, "add", "new.md");
			},
			(repo) =>
				Effect.gen(function* () {
					assert.deepStrictEqual(yield* lint(repo, "../new.md"), []);
				}),
		),
	);

	it.effect("treats a directory as tracked when it holds a tracked file, and flags a wholly ignored directory", () =>
		withRepo(
			true,
			async (repo) => {
				await put(repo, ".gitignore", "build/\n");
				await put(repo, "src/a.ts");
				await put(repo, "build/out.js");
				await put(repo, "okf/thing.md");
				sh(repo, "add", ".gitignore", "src");
			},
			(repo) =>
				Effect.gen(function* () {
					const ds = yield* lint(repo, "../src", "../build");
					assert.deepStrictEqual(summary(ds), ["resource-ignored:error"]);
				}),
		),
	);

	it.effect("ignores missing files, URLs and globs (other lints own them)", () =>
		withRepo(
			true,
			async (repo) => {
				await put(repo, "okf/thing.md");
			},
			(repo) =>
				Effect.gen(function* () {
					assert.deepStrictEqual(yield* lint(repo, "../missing.md", "https://example.com/x", "../*.md"), []);
				}),
		),
	);

	it.effect("skips a bundle outside a git repository", () =>
		withRepo(
			false,
			async (repo) => {
				await put(repo, "new.md");
				await put(repo, "okf/thing.md");
			},
			(repo) =>
				Effect.gen(function* () {
					assert.deepStrictEqual(yield* lint(repo, "../new.md"), []);
				}),
		),
	);

	it.effect("resolves a path inside a submodule against the submodule's own index", () =>
		withRepo(
			true,
			async (repo) => {
				const sub = await realpath(await mkdtemp(join(tmpdir(), "okfit-untracked-sub-")));
				await put(sub, "tracked.md");
				await put(sub, ".gitignore", "ignored.md\n");
				sh(sub, "init", "-q");
				sh(sub, "add", ".");
				sh(sub, "commit", "-qm", "sub");
				await put(sub, "ignored.md");
				await put(sub, "loose.md");
				// `-c protocol.file.allow=always`: a local-path submodule is refused otherwise.
				sh(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "vendor/lib");
				await put(repo, "vendor/lib/ignored.md");
				await put(repo, "vendor/lib/loose.md");
				await put(repo, "okf/thing.md");
				sh(repo, "commit", "-qm", "add sub");
			},
			(repo) =>
				Effect.gen(function* () {
					const ds = yield* lint(
						repo,
						"../vendor/lib",
						"../vendor/lib/tracked.md",
						"../vendor/lib/ignored.md",
						"../vendor/lib/loose.md",
					);
					assert.deepStrictEqual(summary(ds), ["resource-ignored:error", "resource-untracked:warning"]);
				}),
		),
	);

	it.effect("returns [] without touching git when both codes are off", () =>
		Effect.gen(function* () {
			const config: OkfitConfig = {
				...OkfitConfig.DEFAULTS,
				lint: { ...OkfitConfig.DEFAULTS.lint, resource_ignored: "off", resource_untracked: "off" },
			};
			const ds = yield* lintUntrackedResources(
				bundleAt("/does/not/exist", conceptWith(["../x.md"])),
				config,
				"/does",
			).pipe(Effect.provide(platform));
			assert.deepStrictEqual(ds, []);
		}),
	);
});

describe("lintUntrackedResources containment (R1)", () => {
	it.effect(
		"never reaches git or /elsewhere for a symlink out of the project, and still classifies an in-repo path",
		() => {
			const touched: Array<string> = [];
			const lsFilesCalls: Array<ReadonlyArray<string>> = [];
			const repoRootCalls: Array<string> = [];
			const git = Git.layerTest({
				repoRoot: (cwd) =>
					Effect.suspend(() => {
						repoRootCalls.push(cwd);
						return Effect.succeed("/repo");
					}),
				submoduleStatus: () => Effect.succeed([]),
				lsFiles: (_cwd, options) =>
					Effect.suspend(() => {
						lsFilesCalls.push(options?.pathspec ?? []);
						return Effect.succeed([] as ReadonlyArray<LsFilesEntry>);
					}),
				checkIgnore: () => Effect.succeed([]),
			});
			const platform = Layer.mergeAll(
				seedPlatform(
					{
						"/repo/okf/.keep": "",
						"/repo/loose.md": "x",
						"/repo/link": MemoryFileSystem.symlink("/elsewhere/real"),
						"/elsewhere/real": "secret",
					},
					denyAccess(touched, [], "/elsewhere"),
				),
				git,
			);
			const run = (...resources: Array<string>) =>
				lintUntrackedResources(bundleAt("/repo/okf", conceptWith(resources)), OkfitConfig.DEFAULTS, "/repo");
			return Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				assert.deepStrictEqual(yield* run("../link"), []);
				assert.deepStrictEqual(lsFilesCalls, []);
				assert.deepStrictEqual(repoRootCalls, []);
				assert.deepStrictEqual(touched, []);
				// control: an in-repo path the double answers as untracked is reported and reaches git
				assert.deepStrictEqual(summary(yield* run("../link", "../loose.md")), ["resource-untracked:warning"]);
				assert.deepStrictEqual(lsFilesCalls, [["loose.md"]]);
				// a value that leaves the project lexically is silent here too (lintResources reports it)
				assert.deepStrictEqual(yield* run("../../elsewhere/real"), []);
				// the guard is armed
				yield* Effect.flip(fs.exists("/elsewhere/real"));
				assert.deepStrictEqual(touched, ["exists /elsewhere/real"]);
			}).pipe(Effect.provide(platform));
		},
	);
});
