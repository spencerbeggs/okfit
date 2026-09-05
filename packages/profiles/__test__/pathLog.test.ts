import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { classifyFailure, parsePathLog, pathLogArgs } from "../src/internal/pathLog.js";
import {
	C3_AUTHORED_AT,
	C3_SHA,
	C4_AUTHORED_AT,
	C4_COMMITTED_AT,
	C4_SHA,
	C5_AUTHORED_AT,
	C5_SHA,
	HEADER_WITH_FOUR_FIELDS,
	MISSING_SEPARATOR,
	PATH_AFTER_RENAME,
	PATH_BEFORE_RENAME,
	RECORD_WITHOUT_PATH,
	THREE_COMMITS_WITH_RENAME,
} from "./fixtures/pathLogOutput.js";

const FORMAT = "--format=%x1e%H%x00%aI%x00%cI%x00%an%x00%ae";

describe("pathLogArgs", () => {
	it("builds the P-46 argv; --max-count appears only when limit is set, before --name-only", () => {
		assert.deepStrictEqual(pathLogArgs("okf/modules/core.md"), [
			"log",
			"--follow",
			"--diff-merges=first-parent",
			FORMAT,
			"--name-only",
			"--",
			"okf/modules/core.md",
		]);
		assert.deepStrictEqual(pathLogArgs("--oneline", 2), [
			"log",
			"--follow",
			"--diff-merges=first-parent",
			FORMAT,
			"--max-count=2",
			"--name-only",
			"--",
			"--oneline",
		]);
	});
});

describe("parsePathLog", () => {
	it("parses the probed byte shape newest first; the rename's newer entry carries the new path", () => {
		const entries = Result.getOrThrow(parsePathLog(THREE_COMMITS_WITH_RENAME));
		assert.deepStrictEqual(entries, [
			{
				sha: C5_SHA,
				authoredAt: C5_AUTHORED_AT,
				committedAt: C5_AUTHORED_AT,
				authorName: "Okfit Test",
				authorEmail: "okfit-test@example.com",
				path: PATH_AFTER_RENAME,
			},
			{
				sha: C4_SHA,
				authoredAt: C4_AUTHORED_AT,
				committedAt: C4_COMMITTED_AT,
				authorName: "Okfit Test",
				authorEmail: "okfit-test@example.com",
				path: PATH_BEFORE_RENAME,
			},
			{
				sha: C3_SHA,
				authoredAt: C3_AUTHORED_AT,
				committedAt: C3_AUTHORED_AT,
				authorName: "Okfit Test",
				authorEmail: "okfit-test@example.com",
				path: PATH_BEFORE_RENAME,
			},
		]);
	});
	it("empty stdout (untracked or staged-only path) is an empty history", () => {
		assert.deepStrictEqual(Result.getOrThrow(parsePathLog("")), []);
	});
	it("a record without a path line, a four-field header, or a missing separator is malformed", () => {
		for (const stdout of [RECORD_WITHOUT_PATH, HEADER_WITH_FOUR_FIELDS, MISSING_SEPARATOR, "\x1e"]) {
			const result = parsePathLog(stdout);
			assert.isTrue(Result.isFailure(result));
			assert.strictEqual(Result.isFailure(result) ? result.failure : "", "malformed log output");
		}
	});
});

describe("classifyFailure", () => {
	it("maps the LC_ALL=C stderr rows (P-11)", () => {
		assert.strictEqual(
			classifyFailure("fatal: not a git repository (or any of the parent directories): .git\n"),
			"notARepository",
		);
		assert.strictEqual(classifyFailure("fatal: your current branch 'main' does not have any commits yet\n"), "unborn");
		assert.strictEqual(
			classifyFailure("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\n"),
			"unborn",
		);
		assert.strictEqual(
			classifyFailure("fatal: ../outside.md: '../outside.md' is outside repository at '/repo'\n"),
			"failed",
		);
		assert.strictEqual(classifyFailure(""), "failed");
	});
});
