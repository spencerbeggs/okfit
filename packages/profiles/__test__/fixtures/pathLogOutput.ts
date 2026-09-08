// Shas and %aI/%cI dates for a replay of the F4 history (decisions P-33): the three newest entries that
// straddle the c5 rename (c5 rename, c4 frontmatter-only stamp with a different committer date, c3 body).
// `GitHistory.test.ts`'s `GitHistory.makeTest`/`layerTest` doubles are scripted from these; the parser this
// fixture used to feed (`internal/pathLog.ts`) is gone now that `GitHistory` delegates to `Git.log`
// (okfit #10, effected #627).

export const C5_SHA = "99c12e7ebea1d9bb91674898517e30a6bb6e780c";
export const C4_SHA = "3b5760f57a41371f7a60346efe7dbe0cb3c92584";
export const C3_SHA = "0cf2a1b862b9878d7e261b4e6f5968e8913ab18d";

export const C5_AUTHORED_AT = "2026-05-01T10:00:00+02:00";
export const C4_AUTHORED_AT = "2026-04-01T10:00:00+02:00";
export const C4_COMMITTED_AT = "2026-04-05T12:30:00-04:00";
export const C3_AUTHORED_AT = "2026-03-01T10:00:00+02:00";

export const PATH_BEFORE_RENAME = "okf/modules/core.md";
export const PATH_AFTER_RENAME = "okf/modules/core-lib.md";
