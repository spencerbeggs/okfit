import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * One committed body's identity, set repo-local (S-17, Global Constraints:
 * never `HOME=`). Distinct from `verify.e2e.test.ts`'s `ada@example.com`
 * only so a stray cross-import between the two suites would be
 * immediately visible in a failing assertion, not silently pass.
 */
const AUTHOR_NAME = "Ada Lovelace";
const AUTHOR_EMAIL = "ada@example.com";

/**
 * `git init` on `main`, with identity set by `git config user.name`/
 * `git config user.email` INSIDE the sandbox repository itself (S-17) --
 * never `HOME=`, matching Global Constraints and modelled on (but not
 * imported from -- test utils never cross packages, S-17/judge note 11)
 * `packages/profiles/__test__/utils/git.ts`'s own `initRepo`. Commit
 * signing is disabled the same way that fixture builder does, so a host
 * machine's own signing config can never make a sandbox commit hang on a
 * passphrase prompt.
 *
 * @public
 */
export const initRepo = async (dir: string, env: NodeJS.ProcessEnv): Promise<void> => {
	await execFileAsync("git", ["-c", "init.defaultBranch=main", "init"], { cwd: dir, env });
	await execFileAsync("git", ["config", "user.name", AUTHOR_NAME], { cwd: dir, env });
	await execFileAsync("git", ["config", "user.email", AUTHOR_EMAIL], { cwd: dir, env });
	await execFileAsync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, env });
	await execFileAsync("git", ["config", "tag.gpgsign", "false"], { cwd: dir, env });
};

/** @public */
export interface CommitOptions {
	readonly message: string;
	/** An ISO-8601 instant with an explicit offset (e.g. `2026-09-02T00:00:00+00:00`) -- `git`'s own accepted `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` shape. */
	readonly authoredAt: string;
	/** Defaults to `authoredAt` -- most fixture commits below need author and committer dates identical. */
	readonly committedAt?: string;
}

/**
 * Stages everything in `dir` (`git add -A`) and commits it with
 * `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` set from `options` (S-17) --
 * never the wall clock, so every derived `generated.at` and log date in
 * this task's suite is deterministic. Returns the new commit's sha via
 * `git rev-parse HEAD`, exactly as contract §12.3 specifies.
 *
 * @public
 */
export const commit = async (dir: string, options: CommitOptions, env: NodeJS.ProcessEnv): Promise<string> => {
	await execFileAsync("git", ["add", "-A"], { cwd: dir, env });
	const commitEnv: NodeJS.ProcessEnv = {
		...env,
		GIT_AUTHOR_DATE: options.authoredAt,
		GIT_COMMITTER_DATE: options.committedAt ?? options.authoredAt,
	};
	await execFileAsync("git", ["commit", "-q", "-m", options.message], { cwd: dir, env: commitEnv });
	const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir, env });
	return stdout.trim();
};

/**
 * Rewrites HEAD's author/committer date in place (`git commit --amend`, no
 * staging, no tree change) -- the minimal reproduction of what a squash or
 * rebase merge does to every commit it rewrites (issue #19): the blob is
 * carried verbatim, only the date changes. Returns the amended commit's sha.
 *
 * @public
 */
export const amendDate = async (dir: string, authoredAt: string, env: NodeJS.ProcessEnv): Promise<string> => {
	const commitEnv: NodeJS.ProcessEnv = { ...env, GIT_AUTHOR_DATE: authoredAt, GIT_COMMITTER_DATE: authoredAt };
	await execFileAsync("git", ["commit", "-q", "--amend", "--no-edit"], { cwd: dir, env: commitEnv });
	const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: dir, env });
	return stdout.trim();
};
