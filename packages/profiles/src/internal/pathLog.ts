// P-5 as amended by P-46, and P-11: the argv builder, the record parser and the stderr classifier that
// GitHistory.layer composes (api-contract.md section 2, "GitHistory.layer behaviour"). Pure: no Effect in R,
// no process. Not exported from the barrel (P-36).

import { Result } from "effect"; // EF/index.ts:502; Result.succeed EF/Result.ts:278, fail :305

/** `%x1e` opens every record: `--name-only` output has no other unambiguous record boundary. */
export const RECORD_SEPARATOR = "\x1e";

/** `%x00` joins the five header fields. */
export const FIELD_SEPARATOR = "\0";

const MALFORMED = "malformed log output";

const LOG_FORMAT = "--format=%x1e%H%x00%aI%x00%cI%x00%an%x00%ae";

/**
 * The `git log` argv without the leading `git`. `--follow` takes the single path `pathLog` receives (P-5);
 * `--diff-merges=first-parent` lists a merge whose blob differs from its first parent, such as a conflict
 * resolution, with a path line, while a merge TREESAME to its first parent stays hidden (P-46; probed on
 * git 2.54.0); `--max-count=<n>` carries `limit` (P-3, P-8); the trailing `--` keeps an option-like path
 * from being read as an option, as `Git`'s option guard does (effected-git-0-10-0.md section 2.1).
 * `limit` is tested against `undefined`, not truthiness as the contract's argv sketch abbreviates it, because
 * `PathLogOptions` says "`--max-count=<n>` when set" and `makeTest` slices to `limit`: `limit: 0` must be
 * `--max-count=0` (an empty list, probed) on both shapes rather than the whole history on the live one. (checked)
 */
export const pathLogArgs = (path: string, limit?: number): ReadonlyArray<string> => [
	"log",
	"--follow",
	"--diff-merges=first-parent",
	LOG_FORMAT,
	...(limit === undefined ? [] : [`--max-count=${limit}`]),
	"--name-only",
	"--",
	path,
];

/** One record before date decoding; every field is git's raw text. */
export interface RawPathLogEntry {
	readonly sha: string;
	readonly authoredAt: string;
	readonly committedAt: string;
	readonly authorName: string;
	readonly authorEmail: string;
	readonly path: string;
}

/**
 * Parses the stdout of {@link pathLogArgs}. Probed byte shape per record (git 2.54.0):
 * `\x1e<H>\0<aI>\0<cI>\0<an>\0<ae>\n\n<path>\n`. Splits on `\x1e` and drops the empty first segment; a
 * record's first line is the five NUL-joined fields and its last non-empty line is the path, which git
 * prints repository-root-relative regardless of `cwd`. Empty stdout is `[]` (an untracked or staged-only
 * path, exit 0). A record with no path line, a header with the wrong field count, or output that does not
 * open with the separator fails with `"malformed log output"`.
 */
export const parsePathLog = (stdout: string): Result.Result<ReadonlyArray<RawPathLogEntry>, string> => {
	if (stdout === "") return Result.succeed([]);
	if (!stdout.startsWith(RECORD_SEPARATOR)) return Result.fail(MALFORMED);
	const entries: Array<RawPathLogEntry> = [];
	for (const record of stdout.split(RECORD_SEPARATOR).slice(1)) {
		const lines = record.split("\n");
		const [sha, authoredAt, committedAt, authorName, authorEmail, ...rest] = (lines[0] ?? "").split(FIELD_SEPARATOR);
		if (
			rest.length > 0 ||
			sha === undefined ||
			sha === "" ||
			authoredAt === undefined ||
			committedAt === undefined ||
			authorName === undefined ||
			authorEmail === undefined
		) {
			return Result.fail(MALFORMED);
		}
		let path: string | undefined;
		for (let index = lines.length - 1; index >= 1; index--) {
			const line = lines[index];
			if (line !== undefined && line !== "") {
				path = line;
				break;
			}
		}
		if (path === undefined) return Result.fail(MALFORMED);
		entries.push({ sha, authoredAt, committedAt, authorName, authorEmail, path });
	}
	return Result.succeed(entries);
};

/**
 * Classifies a non-zero exit by its `LC_ALL=C` stderr, in the order `GitHistory.layer` applies the rows
 * (P-11; effected-git-0-10-0.md section 3.2): `not a git repository` -> `notARepository`;
 * `does not have any commits yet` or `unknown revision` (an unborn HEAD) -> `unborn`; otherwise `failed`.
 * Matching is an unanchored substring, as `Git`'s classifier.
 */
export const classifyFailure = (stderr: string): "notARepository" | "unborn" | "failed" =>
	stderr.includes("not a git repository")
		? "notARepository"
		: stderr.includes("does not have any commits yet") || stderr.includes("unknown revision")
			? "unborn"
			: "failed";
