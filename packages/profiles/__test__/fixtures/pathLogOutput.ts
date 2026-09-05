// Captured stdout of
//   git log --follow --diff-merges=first-parent --format=%x1e%H%x00%aI%x00%cI%x00%an%x00%ae --name-only -- okf/modules/core-lib.md
// on git 2.54.0 over a replay of the F4 history (decisions P-33): the three newest entries that straddle the
// c5 rename (c5 rename, c4 frontmatter-only stamp with a different committer date, c3 body). Byte shape per
// record: \x1e<H>\0<aI>\0<cI>\0<an>\0<ae>\n\n<path>\n (api-contract.md section 2, "parse").

const RS = "\x1e";
const NUL = "\0";
const AUTHOR_NAME = "Okfit Test";
const AUTHOR_EMAIL = "okfit-test@example.com";

const header = (sha: string, authoredAt: string, committedAt: string): string =>
	[sha, authoredAt, committedAt, AUTHOR_NAME, AUTHOR_EMAIL].join(NUL);

export const C5_SHA = "99c12e7ebea1d9bb91674898517e30a6bb6e780c";
export const C4_SHA = "3b5760f57a41371f7a60346efe7dbe0cb3c92584";
export const C3_SHA = "0cf2a1b862b9878d7e261b4e6f5968e8913ab18d";

export const C5_AUTHORED_AT = "2026-05-01T10:00:00+02:00";
export const C4_AUTHORED_AT = "2026-04-01T10:00:00+02:00";
export const C4_COMMITTED_AT = "2026-04-05T12:30:00-04:00";
export const C3_AUTHORED_AT = "2026-03-01T10:00:00+02:00";

export const PATH_BEFORE_RENAME = "okf/modules/core.md";
export const PATH_AFTER_RENAME = "okf/modules/core-lib.md";

/** Three records, newest first; the rename's newer entry carries the new path. */
export const THREE_COMMITS_WITH_RENAME =
	`${RS}${header(C5_SHA, C5_AUTHORED_AT, C5_AUTHORED_AT)}\n\n${PATH_AFTER_RENAME}\n` +
	`${RS}${header(C4_SHA, C4_AUTHORED_AT, C4_COMMITTED_AT)}\n\n${PATH_BEFORE_RENAME}\n` +
	`${RS}${header(C3_SHA, C3_AUTHORED_AT, C3_AUTHORED_AT)}\n\n${PATH_BEFORE_RENAME}\n`;

/** A record whose path line never arrived (truncated output). */
export const RECORD_WITHOUT_PATH = `${RS}${header(C3_SHA, C3_AUTHORED_AT, C3_AUTHORED_AT)}\n\n`;

/** A header with four fields (a `--format` without `%ae`). */
export const HEADER_WITH_FOUR_FIELDS = `${RS}${[C3_SHA, C3_AUTHORED_AT, C3_AUTHORED_AT, AUTHOR_NAME].join(NUL)}\n\n${PATH_BEFORE_RENAME}\n`;

/** Output that does not open with the record separator (a `--format` without `%x1e`). */
export const MISSING_SEPARATOR = `${C3_SHA}\n\n${PATH_BEFORE_RENAME}\n`;
