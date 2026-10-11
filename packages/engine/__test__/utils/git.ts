import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

/** A git environment that ignores the host's global and system config. */
const GIT_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	LC_ALL: "C",
};

/** Runs git in `cwd`, with both commit dates pinned to `date` when given. */
export const git = (cwd: string, args: ReadonlyArray<string>, date?: string): void => {
	execFileSync("git", [...args], {
		cwd,
		env: date === undefined ? GIT_ENV : { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
		stdio: "pipe",
	});
};

/** A real (symlink-resolved) temp directory, removed afterwards. */
export const withDir = <A, E, R>(prefix: string, body: (dir: string) => Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), prefix)))),
		body,
		(dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
	);

/** `git init` with a fixed identity and no signing. */
export const initRepo = (dir: string): void => {
	git(dir, ["-c", "init.defaultBranch=main", "init", "-q"]);
	git(dir, ["config", "user.name", "Ada"]);
	git(dir, ["config", "user.email", "ada@example.com"]);
	git(dir, ["config", "commit.gpgsign", "false"]);
};

/** Stages everything and commits it at `date`. */
export const commit = (dir: string, message: string, date: string): void => {
	git(dir, ["add", "-A"]);
	git(dir, ["commit", "-q", "-m", message], date);
};
