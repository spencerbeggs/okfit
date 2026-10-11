import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Git } from "@effected/git";
import type { ActorPattern } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Derivation } from "@okfit/profiles";
import { DateTime, Effect, Layer, Option } from "effect";

export const AT = DateTime.makeUnsafe("2026-09-16T12:00:00Z");

export const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, {
	types: { Decision: { require_verified: true }, Module: { require_verified: true } },
	actors: { humans: ["human:ada" as ActorPattern] },
	extensions: {},
});

/** A fake `Git` whose identity resolves to `human:ada`. */
export const platform = Layer.mergeAll(
	Layer.succeed(Git, {
		configGet: (_cwd: string, key: string) =>
			Effect.succeed(
				key === "user.name"
					? Option.some("Ada")
					: key === "user.email"
						? Option.some("ada@example.com")
						: Option.none(),
			),
	} as unknown as Git["Service"]),
	NodeServices.layer,
);

const concept = (type: string, title: string, extra = "", description?: string): string =>
	`---\ntype: ${type}\ntitle: ${title}\n${description === undefined ? "" : `description: ${description}\n`}${extra}---\n\n# ${title}\n`;

/** Where a fixture puts the content digest `bindFixtures` fills in. */
export const DIGEST = "__DIGEST__";

export const FILES: ReadonlyArray<readonly [string, string]> = [
	["decisions/a.md", concept("Decision", "Alpha", "status: draft\n", "first choice")],
	["decisions/b.md", concept("Decision", "Beta")],
	[
		"decisions/c.md",
		concept(
			"Decision",
			"Gamma",
			`verified:\n  - by: human:ada\n    at: 2026-09-01T00:00:00Z\nintegrity:\n  verified:\n    by: human:ada\n    at: 2026-09-01T00:00:00Z\n    content: ${DIGEST}\n`,
		),
	],
	["modules/m.md", concept("Module", "Mu", "verified:\n  - by: human:bob\n    at: 2026-09-01T00:00:00Z\n")],
];

/** A temp bundle with `files`, removed afterwards. */
export const withBundle = <A, E, R>(
	files: ReadonlyArray<readonly [string, string]>,
	body: (root: string) => Effect.Effect<A, E, R>,
) =>
	Effect.acquireUseRelease(
		Effect.gen(function* () {
			const root = yield* Effect.promise(async () => {
				const dir = await mkdtemp(join(tmpdir(), "okfit-picker-"));
				for (const [name, text] of files) {
					await mkdir(join(dir, name, ".."), { recursive: true });
					await writeFile(join(dir, name), text);
				}
				return dir;
			});
			// Fixtures that carry a DIGEST placeholder get their real content digest.
			yield* bindFixtures(
				root,
				files.filter(([, text]) => text.includes(DIGEST)).map(([name]) => name),
			);
			return root;
		}),
		body,
		(root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
	);

export const read = (root: string, file: string) => Effect.promise(() => readFile(join(root, file), "utf8"));

/** Replaces {@link DIGEST} in the named bundle files with each concept's real content digest (it excludes `integrity`). */
export const bindFixtures = (root: string, names: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root });
		for (const name of names) {
			const loaded = [...bundle.concepts.values()].find((entry) => entry.path === name);
			if (loaded === undefined) return yield* Effect.die(new Error(`no concept ${name}`));
			const digest = yield* Derivation.contentDigest(loaded.frontmatter.raw, loaded.document.source);
			const text = yield* Effect.promise(() => readFile(join(root, name), "utf8"));
			yield* Effect.promise(() => writeFile(join(root, name), text.replaceAll(DIGEST, digest)));
		}
	}).pipe(Effect.provide(NodeServices.layer));

/** The real `Git` (history and identity read from the temp repository) over Node's services. */
export const repoPlatform = Layer.mergeAll(Git.layer, NodeServices.layer).pipe(Layer.provideMerge(NodeServices.layer));

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" };

const git = (cwd: string, args: ReadonlyArray<string>, date?: string): void => {
	execFileSync("git", [...args], {
		cwd,
		env: date === undefined ? GIT_ENV : { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
		stdio: "pipe",
	});
};

/** The line appended to `decisions/c.md` after its commit, so its verification drifts (content-changed). */
export const DRIFT_EDIT = "An edit after the verification.";

/**
 * {@link FILES} in a git repository whose identity is Ada: committed before
 * `decisions/c.md`'s binding (2026-09-01), then `decisions/c.md` edited, so the
 * picker offers it again as drifted, with a diff to preview.
 */
export const withDriftedRepoBundle = <A, E, R>(body: (root: string) => Effect.Effect<A, E, R>) =>
	withBundle(FILES, (root) =>
		Effect.gen(function* () {
			git(root, ["-c", "init.defaultBranch=main", "init", "-q"]);
			git(root, ["config", "user.name", "Ada"]);
			git(root, ["config", "user.email", "ada@example.com"]);
			git(root, ["config", "commit.gpgsign", "false"]);
			git(root, ["add", "-A"]);
			git(root, ["commit", "-q", "-m", "bundle"], "2026-08-31T00:00:00Z");
			const file = join(root, "decisions/c.md");
			yield* Effect.promise(async () => writeFile(file, `${await readFile(file, "utf8")}\n${DRIFT_EDIT}\n`));
			return yield* body(root);
		}),
	);
