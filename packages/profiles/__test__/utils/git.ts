import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PlatformError } from "effect";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { HistoryStep } from "../fixtures/history.js";
import { FIXTURE_AUTHOR_EMAIL, FIXTURE_AUTHOR_NAME } from "../fixtures/history.js";

/**
 * P-34: no host config, no system config, C locale, no credential prompt.
 * Merged with `extendEnv: true` so the child keeps `PATH`
 * (EF/unstable/process/ChildProcess.ts:393, :405).
 */
export const FIXTURE_ENV = {
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	LC_ALL: "C",
	GIT_TERMINAL_PROMPT: "0",
} as const;

export interface Collected {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

export type GitEnv = Readonly<Record<string, string>>;

export interface FixtureRepo {
	/** `realpath`-resolved temp directory (P-34; effected-git-0-10-0.md section 2.3). */
	readonly dir: string;
	/** Real sha per named commit of the replayed history. */
	readonly shas: Readonly<Record<string, string>>;
}

/**
 * The fixtures' own copy of `@effected/git`'s `runCollected` (P-36): one spawn,
 * stdout and stderr collected concurrently with the exit code
 * (effected-git-0-10-0.md section 2.1; EF/unstable/process/ChildProcessSpawner.ts:256, :89, :115, :124;
 * EF/Stream.ts:9197, :10831; EF/Effect.ts:494, :6436).
 */
export const runCollected = (
	command: ChildProcess.Command,
): Effect.Effect<Collected, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.scoped(
		Effect.gen(function* () {
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
			const handle = yield* spawner.spawn(command);
			const [stdout, stderr, exitCode] = yield* Effect.all(
				[
					Stream.mkString(Stream.decodeText(handle.stdout)),
					Stream.mkString(Stream.decodeText(handle.stderr)),
					handle.exitCode,
				],
				{ concurrency: "unbounded" },
			);
			return { stdout, stderr, exitCode };
		}),
	);

/** Runs `git <args>` in `cwd` under `FIXTURE_ENV` plus `env`; spawn failure is a defect, the exit code is returned. */
export const gitRaw = (
	cwd: string,
	args: ReadonlyArray<string>,
	env: GitEnv = {},
): Effect.Effect<Collected, never, ChildProcessSpawner.ChildProcessSpawner> =>
	runCollected(
		ChildProcess.setCwd(ChildProcess.make("git", args, { env: { ...FIXTURE_ENV, ...env }, extendEnv: true }), cwd),
	).pipe(Effect.orDie);

/** As `gitRaw`, but a non-zero exit is a defect too (fixture failures never read as passes); returns trimmed stdout. */
export const git = (
	cwd: string,
	args: ReadonlyArray<string>,
	env: GitEnv = {},
): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
	gitRaw(cwd, args, env).pipe(
		Effect.flatMap((result) =>
			result.exitCode === 0
				? Effect.succeed(result.stdout.trim())
				: Effect.die(
						new Error(`fixture git ${args.join(" ")} failed (exit ${result.exitCode}) in ${cwd}: ${result.stderr}`),
					),
		),
	);

/** `mkdtemp` under the OS temp dir, `realpath`-resolved so it equals `git rev-parse --show-toplevel` (P-34). */
export const makeTempDir = (prefix = "okfit-profiles-"): Effect.Effect<string> =>
	Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), prefix))));

/** `afterAll` cleanup. */
export const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true });

/** `git init` on `main` with the repo-local identity and signing off (P-34). */
export const initRepo = (dir: string): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		yield* git(dir, ["-c", "init.defaultBranch=main", "init"]);
		yield* git(dir, ["config", "user.name", FIXTURE_AUTHOR_NAME]);
		yield* git(dir, ["config", "user.email", FIXTURE_AUTHOR_EMAIL]);
		yield* git(dir, ["config", "commit.gpgsign", "false"]);
		yield* git(dir, ["config", "tag.gpgsign", "false"]);
	});

const commitEnv = (authoredAt: string, committedAt: string): GitEnv => ({
	GIT_AUTHOR_DATE: authoredAt,
	GIT_COMMITTER_DATE: committedAt,
});

const writeFileAt = (dir: string, path: string, text: string): Effect.Effect<void> =>
	Effect.promise(async () => {
		const file = join(dir, path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text, "utf8");
	});

/** Replays `steps` in `dir` (an initialised repository) and returns the real sha of every named commit. */
export const replayHistory = (
	dir: string,
	steps: ReadonlyArray<HistoryStep>,
): Effect.Effect<Readonly<Record<string, string>>, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		const shas: Record<string, string> = {};
		for (const step of steps) {
			if (step.kind === "write") {
				yield* writeFileAt(dir, step.path, step.text);
				yield* git(dir, ["add", "-A"]);
				yield* git(dir, ["commit", "-q", "-m", step.message], commitEnv(step.authoredAt, step.committedAt));
				shas[step.name] = yield* git(dir, ["rev-parse", "HEAD"]);
			} else if (step.kind === "rename") {
				yield* git(dir, ["mv", step.from, step.to]);
				yield* git(dir, ["commit", "-q", "-m", step.message], commitEnv(step.authoredAt, step.committedAt));
				shas[step.name] = yield* git(dir, ["rev-parse", "HEAD"]);
			} else if (step.kind === "branch") {
				yield* git(dir, ["checkout", "-q", "-b", step.branch]);
			} else if (step.kind === "checkout") {
				yield* git(dir, ["checkout", "-q", step.branch]);
			} else {
				const env = commitEnv(step.authoredAt, step.committedAt);
				const merged = yield* gitRaw(dir, ["merge", "--no-ff", "-m", step.message, step.branch], env);
				if (step.resolution === undefined) {
					if (merged.exitCode !== 0) {
						return yield* Effect.die(
							new Error(`fixture merge of ${step.branch} failed (exit ${merged.exitCode}): ${merged.stderr}`),
						);
					}
				} else {
					if (merged.exitCode === 0) {
						return yield* Effect.die(new Error(`fixture merge of ${step.branch} was expected to conflict but did not`));
					}
					yield* writeFileAt(dir, step.resolution.path, step.resolution.text);
					yield* git(dir, ["add", "-A"]);
					yield* git(dir, ["commit", "-q", "-m", step.message], env);
				}
				shas[step.name] = yield* git(dir, ["rev-parse", "HEAD"]);
			}
		}
		return shas;
	});

/** One temp repository with `steps` replayed; call from `beforeAll`, remove with `removeDir` in `afterAll` (P-33). */
export const buildRepo = (
	steps: ReadonlyArray<HistoryStep>,
): Effect.Effect<FixtureRepo, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		const dir = yield* makeTempDir();
		yield* initRepo(dir);
		const shas = yield* replayHistory(dir, steps);
		return { dir, shas };
	});

/** A repository with an unborn `HEAD` (P-11, P-33): initialised, identity set, no commits. */
export const buildUnbornRepo = (): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		const dir = yield* makeTempDir();
		yield* initRepo(dir);
		return dir;
	});
