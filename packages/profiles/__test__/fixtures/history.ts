/**
 * Replay data for the derivation suites: the F4 history (P-33) and the
 * conflict-resolving merge (P-46). Shared by the unit suites (as
 * `GitHistory.layerTest` scripts and `Git.layerTest` `show` answers) and by
 * the integration builder in `../utils/git.ts` (as the replayed commits).
 *
 * Nothing here imports `../../src/`: group A runs before `PathHistoryEntry`
 * exists. `F4_ENTRIES` and `CONFLICT_ENTRIES` carry that class's ENCODED
 * shape, so a test builds values with
 * `Schema.decodeUnknownSync(PathHistoryEntry)(entry)`.
 */

/** Repo-local identity every fixture commit carries (P-34). */
export const FIXTURE_AUTHOR_NAME = "Okfit Test";
export const FIXTURE_AUTHOR_EMAIL = "okfit-test@example.com";

/** The concept file before and after `c5`'s `git mv` (P-5: `--follow`). */
export const F4_PATH_ORIGINAL = "okf/modules/core.md";
export const F4_PATH_RENAMED = "okf/modules/core-lib.md";

/**
 * One step of a replayed history. `write` and `rename` commit with pinned
 * `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE`; `merge` is always `--no-ff` and,
 * when `resolution` is set, expects a conflict that it resolves to that text.
 */
export type HistoryStep =
	| {
			readonly kind: "write";
			readonly name: string;
			readonly path: string;
			readonly text: string;
			readonly message: string;
			readonly authoredAt: string;
			readonly committedAt: string;
	  }
	| {
			readonly kind: "rename";
			readonly name: string;
			readonly from: string;
			readonly to: string;
			readonly message: string;
			readonly authoredAt: string;
			readonly committedAt: string;
	  }
	| { readonly kind: "branch"; readonly branch: string }
	| { readonly kind: "checkout"; readonly branch: string }
	| {
			readonly kind: "merge";
			readonly name: string;
			readonly branch: string;
			readonly message: string;
			readonly authoredAt: string;
			readonly committedAt: string;
			readonly resolution?: { readonly path: string; readonly text: string };
	  };

/**
 * `PathHistoryEntry`'s encoded shape plus the fixture's commit `name` and the
 * full file `text` at that commit. `sha` is synthetic (40 hex characters) for
 * the unit suites; the integration builder returns the real shas by `name`.
 */
export interface HistoryCommit {
	readonly name: string;
	readonly sha: string;
	readonly authoredAt: string;
	readonly committedAt: string;
	readonly authorName: string;
	readonly authorEmail: string;
	readonly path: string;
	readonly text: string;
}

const moduleFile = (stamp: ReadonlyArray<string>, body: string): string =>
	[
		"---",
		"type: Module",
		"title: Core",
		"description: The core package.",
		"generated:",
		"  by: human:okfit-test",
		...stamp,
		"---",
		"",
		"# Core",
		"",
		body,
		"",
	].join("\n");

const STAMP_ONE = ["  at: 2026-01-01T08:00:00Z", "stale_after: 2026-04-01T08:00:00Z"] as const;
const STAMP_THREE = ["  at: 2026-03-01T08:00:00Z", "stale_after: 2026-05-30T08:00:00Z"] as const;
const BODY_ONE = "Body one.";
const BODY_THREE = "Body one.\n\nBody three.";
const BODY_TOPIC = "Body one.\n\nBody three.\n\nBody topic.";

/** Commit names in creation order. `topic` is the merged branch's commit; `c6` the `--no-ff` merge. */
export const F4_COMMIT_NAMES = ["c1", "c2", "c3", "c4", "c5", "topic", "c6"] as const;
export type F4CommitName = (typeof F4_COMMIT_NAMES)[number];

/** Full file text at each commit (`c5` and `c6` change nothing in the file). */
export const F4_TEXTS: Readonly<Record<F4CommitName, string>> = {
	c1: moduleFile([], BODY_ONE),
	c2: moduleFile(STAMP_ONE, BODY_ONE),
	c3: moduleFile(STAMP_ONE, BODY_THREE),
	c4: moduleFile(STAMP_THREE, BODY_THREE),
	c5: moduleFile(STAMP_THREE, BODY_THREE),
	topic: moduleFile(STAMP_THREE, BODY_TOPIC),
	c6: moduleFile(STAMP_THREE, BODY_TOPIC),
};

export const F4_MESSAGES: Readonly<Record<F4CommitName, string>> = {
	c1: "c1 body",
	c2: "c2 stamp only",
	c3: "c3 body",
	c4: "c4 stamp only (committer date differs)",
	c5: "c5 rename",
	topic: "topic body",
	c6: "c6 merge topic",
};

// Declared ahead of F4_DATES and CONFLICT_DATES, which both use it.
interface PinnedDates {
	readonly authoredAt: string;
	readonly committedAt: string;
}

const F4_DATES: Readonly<Record<F4CommitName, PinnedDates>> = {
	c1: { authoredAt: "2026-01-01T10:00:00+02:00", committedAt: "2026-01-01T10:00:00+02:00" },
	c2: { authoredAt: "2026-02-01T10:00:00+02:00", committedAt: "2026-02-01T10:00:00+02:00" },
	c3: { authoredAt: "2026-03-01T10:00:00+02:00", committedAt: "2026-03-01T10:00:00+02:00" },
	c4: { authoredAt: "2026-04-01T10:00:00+02:00", committedAt: "2026-04-05T12:30:00-04:00" },
	c5: { authoredAt: "2026-05-01T10:00:00+02:00", committedAt: "2026-05-01T10:00:00+02:00" },
	topic: { authoredAt: "2026-06-01T10:00:00+02:00", committedAt: "2026-06-01T10:00:00+02:00" },
	c6: { authoredAt: "2026-06-02T10:00:00+02:00", committedAt: "2026-06-02T10:00:00+02:00" },
};

const write = (name: F4CommitName, path: string): HistoryStep => ({
	kind: "write",
	name,
	path,
	text: F4_TEXTS[name],
	message: F4_MESSAGES[name],
	...F4_DATES[name],
});

/** The replayed F4 sequence: body, stamp, body, stamp, rename, topic body on a branch, `--no-ff` merge. */
export const F4_STEPS: ReadonlyArray<HistoryStep> = [
	write("c1", F4_PATH_ORIGINAL),
	write("c2", F4_PATH_ORIGINAL),
	write("c3", F4_PATH_ORIGINAL),
	write("c4", F4_PATH_ORIGINAL),
	{ kind: "rename", name: "c5", from: F4_PATH_ORIGINAL, to: F4_PATH_RENAMED, message: F4_MESSAGES.c5, ...F4_DATES.c5 },
	{ kind: "branch", branch: "topic" },
	write("topic", F4_PATH_RENAMED),
	{ kind: "checkout", branch: "main" },
	{ kind: "merge", name: "c6", branch: "topic", message: F4_MESSAGES.c6, ...F4_DATES.c6 },
];

/**
 * `git log` order at `HEAD = c6` (newest first), which is also the order
 * `git log --follow --diff-merges=first-parent --name-only -- okf/modules/core-lib.md`
 * lists every one of them (probed on git 2.54.0; contract section 2, `GitHistory.layer`).
 */
export const F4_LOG_ORDER: ReadonlyArray<F4CommitName> = ["c6", "topic", "c5", "c4", "c3", "c2", "c1"];
export const F4_COMMIT_COUNT = F4_LOG_ORDER.length;

const synthSha = (pair: string): string => pair.repeat(20);

const F4_SYNTH_SHAS: Readonly<Record<F4CommitName, string>> = {
	c1: synthSha("c1"),
	c2: synthSha("c2"),
	c3: synthSha("c3"),
	c4: synthSha("c4"),
	c5: synthSha("c5"),
	topic: synthSha("ab"),
	c6: synthSha("c6"),
};

/** Path the blob had at each commit, as the `--name-only` line reports it (P-5). */
const F4_PATHS: Readonly<Record<F4CommitName, string>> = {
	c1: F4_PATH_ORIGINAL,
	c2: F4_PATH_ORIGINAL,
	c3: F4_PATH_ORIGINAL,
	c4: F4_PATH_ORIGINAL,
	c5: F4_PATH_RENAMED,
	topic: F4_PATH_RENAMED,
	c6: F4_PATH_RENAMED,
};

const entry = (name: F4CommitName): HistoryCommit => ({
	name,
	sha: F4_SYNTH_SHAS[name],
	...F4_DATES[name],
	authorName: FIXTURE_AUTHOR_NAME,
	authorEmail: FIXTURE_AUTHOR_EMAIL,
	path: F4_PATHS[name],
	text: F4_TEXTS[name],
});

/** The path log at `HEAD = c6`, newest first, in `PathHistoryEntry`'s encoded shape. */
export const F4_ENTRIES: ReadonlyArray<HistoryCommit> = F4_LOG_ORDER.map(entry);

/**
 * Contract section 2 (`Derivation.generatedAt` step 6) over `F4_ENTRIES`:
 * `c6`'s body equals `topic`'s, `topic`'s differs from `c5`'s, so the last
 * body change at `HEAD = c6` is `topic`. Before the merge (`HEAD = c5`) the
 * walk skips `c5` and `c4` (bodies equal `c3`'s) and answers `c3`, never the
 * `c4` stamp (F5) and never `c4`'s committer date (P-4).
 */
export const F4_EXPECTED_BODY_COMMIT_AT_HEAD: F4CommitName = "topic";
export const F4_EXPECTED_BODY_COMMIT_BEFORE_MERGE: F4CommitName = "c3";

// --- Conflict-resolving merge (P-46; contract Judge notes item 2) ---------------------------

export const CONFLICT_PATH = "okf/modules/core.md";

/** `m1` base, `m2` on branch `left`, `m3` on `main`, `m4` the `--no-ff` merge resolved to a fourth body. */
export const CONFLICT_COMMIT_NAMES = ["m1", "m2", "m3", "m4"] as const;
export type ConflictCommitName = (typeof CONFLICT_COMMIT_NAMES)[number];

const conflictFile = (body: string): string => ["---", "type: Module", "title: Core", "---", "", body, ""].join("\n");

export const CONFLICT_TEXTS: Readonly<Record<ConflictCommitName, string>> = {
	m1: conflictFile("Body A."),
	m2: conflictFile("Body B."),
	m3: conflictFile("Body C."),
	m4: conflictFile("Body D."),
};

export const CONFLICT_MESSAGES: Readonly<Record<ConflictCommitName, string>> = {
	m1: "m1 base",
	m2: "m2 left",
	m3: "m3 main",
	m4: "m4 merge left (resolved)",
};

const CONFLICT_DATES: Readonly<Record<ConflictCommitName, PinnedDates>> = {
	m1: { authoredAt: "2026-01-01T10:00:00+02:00", committedAt: "2026-01-01T10:00:00+02:00" },
	m2: { authoredAt: "2026-02-01T10:00:00+02:00", committedAt: "2026-02-01T10:00:00+02:00" },
	m3: { authoredAt: "2026-03-01T10:00:00+02:00", committedAt: "2026-03-01T10:00:00+02:00" },
	m4: { authoredAt: "2026-04-01T10:00:00+02:00", committedAt: "2026-04-01T10:00:00+02:00" },
};

const conflictWrite = (name: ConflictCommitName): HistoryStep => ({
	kind: "write",
	name,
	path: CONFLICT_PATH,
	text: CONFLICT_TEXTS[name],
	message: CONFLICT_MESSAGES[name],
	...CONFLICT_DATES[name],
});

export const CONFLICT_STEPS: ReadonlyArray<HistoryStep> = [
	conflictWrite("m1"),
	{ kind: "branch", branch: "left" },
	conflictWrite("m2"),
	{ kind: "checkout", branch: "main" },
	conflictWrite("m3"),
	{
		kind: "merge",
		name: "m4",
		branch: "left",
		message: CONFLICT_MESSAGES.m4,
		...CONFLICT_DATES.m4,
		resolution: { path: CONFLICT_PATH, text: CONFLICT_TEXTS.m4 },
	},
];

/**
 * `git log` order at `HEAD = m4`. Probed on git 2.54.0: plain `--follow` lists
 * `m3, m2, m1` and omits the merge; `--follow --diff-merges=first-parent`
 * lists all four with a path line each (P-46).
 */
export const CONFLICT_LOG_ORDER: ReadonlyArray<ConflictCommitName> = ["m4", "m3", "m2", "m1"];
export const CONFLICT_COMMIT_COUNT = CONFLICT_LOG_ORDER.length;

const CONFLICT_SYNTH_SHAS: Readonly<Record<ConflictCommitName, string>> = {
	m1: synthSha("e1"),
	m2: synthSha("e2"),
	m3: synthSha("e3"),
	m4: synthSha("e4"),
};

export const CONFLICT_ENTRIES: ReadonlyArray<HistoryCommit> = CONFLICT_LOG_ORDER.map((name) => ({
	name,
	sha: CONFLICT_SYNTH_SHAS[name],
	...CONFLICT_DATES[name],
	authorName: FIXTURE_AUTHOR_NAME,
	authorEmail: FIXTURE_AUTHOR_EMAIL,
	path: CONFLICT_PATH,
	text: CONFLICT_TEXTS[name],
}));

/** `m4`'s body differs from `m3`'s (its first-parent predecessor in the log), so the walk answers `m4` at once. */
export const CONFLICT_EXPECTED_BODY_COMMIT: ConflictCommitName = "m4";

// --- Non-ASCII path (decision 56: `-c core.quotePath=false`) --------------------------------

/** A concept path with a non-ASCII character and a space, added at its final name in a single commit. */
export const UNICODE_PATH = "okf/modules/wéird name.md";

const UNICODE_TEXT = ["---", "type: Module", "title: Weird", "---", "", "# Weird", "", "A unicode body.", ""].join(
	"\n",
);

/** A small, dedicated step list (P-33 addendum): one commit adding {@link UNICODE_PATH} directly, never renamed. */
export const UNICODE_STEPS: ReadonlyArray<HistoryStep> = [
	{
		kind: "write",
		name: "u1",
		path: UNICODE_PATH,
		text: UNICODE_TEXT,
		message: "u1 add a non-ascii path",
		authoredAt: "2026-07-01T10:00:00+02:00",
		committedAt: "2026-07-01T10:00:00+02:00",
	},
];
