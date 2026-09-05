import { assert, describe, it } from "@effect/vitest";
import { Cause, DateTime, Effect, Exit, Schema } from "effect";
import { GitHistory, GitHistoryError, PathHistoryEntry } from "../src/GitHistory.js";
import {
	C3_AUTHORED_AT,
	C3_SHA,
	C4_AUTHORED_AT,
	C4_COMMITTED_AT,
	C4_SHA,
	C5_AUTHORED_AT,
	C5_SHA,
	PATH_AFTER_RENAME,
	PATH_BEFORE_RENAME,
} from "./fixtures/pathLogOutput.js";

const entry = (sha: string, authoredAt: string, committedAt: string, path: string): PathHistoryEntry =>
	PathHistoryEntry.make({
		sha,
		authoredAt: DateTime.makeUnsafe(authoredAt), // EF/DateTime.ts:653
		committedAt: DateTime.makeUnsafe(committedAt),
		authorName: "Okfit Test",
		authorEmail: "okfit-test@example.com",
		path,
	});

const c5 = entry(C5_SHA, C5_AUTHORED_AT, C5_AUTHORED_AT, PATH_AFTER_RENAME);
const c4 = entry(C4_SHA, C4_AUTHORED_AT, C4_COMMITTED_AT, PATH_BEFORE_RENAME);
const c3 = entry(C3_SHA, C3_AUTHORED_AT, C3_AUTHORED_AT, PATH_BEFORE_RENAME);
const script = { [PATH_AFTER_RENAME]: [c5, c4, c3], "empty.md": [] };
// Bind once: layerTest mints a fresh layer per call and layers memoize by reference (GIT/index.d.ts:1996-1999).
const TestHistory = GitHistory.layerTest(script);

describe("PathHistoryEntry", () => {
	it("decodes git's %aI/%cI text through core's Timestamp and rejects an offset-less date", () => {
		const decoded = Schema.decodeUnknownSync(PathHistoryEntry)({
			sha: C3_SHA,
			authoredAt: C3_AUTHORED_AT,
			committedAt: C3_AUTHORED_AT,
			authorName: "Okfit Test",
			authorEmail: "okfit-test@example.com",
			path: PATH_BEFORE_RENAME,
		});
		assert.strictEqual(DateTime.formatIso(decoded.authoredAt), "2026-03-01T08:00:00.000Z");
		assert.strictEqual(DateTime.toEpochMillis(decoded.committedAt), DateTime.toEpochMillis(c3.committedAt));
		assert.throws(() =>
			Schema.decodeUnknownSync(PathHistoryEntry)({
				sha: C3_SHA,
				authoredAt: "2026-03-01T10:00:00",
				committedAt: C3_AUTHORED_AT,
				authorName: "Okfit Test",
				authorEmail: "okfit-test@example.com",
				path: PATH_BEFORE_RENAME,
			}),
		);
	});
});

describe("GitHistory.makeTest", () => {
	it.effect("answers a scripted path newest first and honours limit by slicing", () =>
		Effect.gen(function* () {
			const double = GitHistory.makeTest(script);
			assert.deepStrictEqual(yield* double.pathLog("/repo", PATH_AFTER_RENAME), [c5, c4, c3]);
			assert.deepStrictEqual(yield* double.pathLog("/repo", PATH_AFTER_RENAME, { limit: 2 }), [c5, c4]);
			assert.deepStrictEqual(yield* double.pathLog("/elsewhere", "empty.md"), []);
		}),
	);
	it.effect("dies, naming the path, on a call that was not scripted (P-32)", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(GitHistory.makeTest(script).pathLog("/repo", "missing.md")); // EF/Effect.ts:2309
			assert.isTrue(Exit.isFailure(exit)); // EF/Exit.ts:421
			if (Exit.isFailure(exit)) {
				assert.isTrue(Cause.hasDies(exit.cause)); // EF/Cause.ts:865
				const defect = Cause.squash(exit.cause); // EF/Cause.ts:736
				assert.strictEqual(
					defect instanceof Error ? defect.message : String(defect),
					"GitHistory.makeTest: pathLog(missing.md) was called but not scripted",
				);
			}
		}),
	);
});

describe("GitHistory.layerTest", () => {
	it.effect("provides the double as the GitHistory service", () =>
		Effect.gen(function* () {
			const history = yield* GitHistory;
			assert.deepStrictEqual(yield* history.pathLog("/repo", PATH_AFTER_RENAME, { limit: 1 }), [c5]);
		}).pipe(Effect.provide(TestHistory)),
	);
	it("carries the shared service identity", () => {
		assert.strictEqual(GitHistory.key, "@okfit/profiles/GitHistory");
	});
});

describe("GitHistoryError", () => {
	it("renders args, exit code and stderr; the detail arm replaces stderr", () => {
		const failed = new GitHistoryError({
			args: ["log", "--", "x.md"],
			cwd: "/repo",
			exitCode: 128,
			stderr: "fatal: bad",
		});
		assert.strictEqual(failed._tag, "GitHistoryError");
		assert.strictEqual(failed.message, "git log -- x.md (exit 128) in /repo: fatal: bad");
		const timedOut = new GitHistoryError({
			args: ["log", "--", "x.md"],
			cwd: "/repo",
			stderr: "",
			detail: "timed out after 30s",
		});
		assert.strictEqual(timedOut.message, "git log -- x.md in /repo: timed out after 30s");
	});
});
