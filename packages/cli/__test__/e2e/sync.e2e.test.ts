import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Derivation } from "@okfit/profiles";
import { Effect } from "effect";
import type { Sandbox } from "./utils/fixtures.js";
import { makeSandbox, removeSandbox } from "./utils/fixtures.js";
import { runOkfit } from "./utils/okfit.js";
import { commit, initRepo } from "./utils/repo.js";

const withServices = <A, E>(effect: Effect.Effect<A, E, NodeServices.NodeServices>): Promise<A> =>
	Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

/** `okfit sync`'s own digest, computed the identical way, so an expectation never hand-rolls a hash. */
const digestOf = (contents: string): Promise<string> => withServices(Derivation.bodyDigest(contents));

const baseEnv = (env: Readonly<Record<string, string>>): Record<string, string> => ({
	...env,
	PATH: process.env.PATH ?? "",
	NO_COLOR: "1",
	// S-17/Global Constraints: `repo.ts`'s `initRepo` sets identity IN-REPO,
	// never HOME=; these two isolate every spawned git call from whatever
	// global/system config the host machine happens to carry.
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
});

const INIT_AUTHORED_AT = "2026-09-01T00:00:00+00:00";

/** A sandbox that is a real git repository, scaffolded by a real `okfit init`, with the scaffold itself committed. */
const seeded = async (): Promise<{
	readonly sandbox: Sandbox;
	readonly cwd: string;
	readonly env: Record<string, string>;
}> => {
	const sandbox = await makeSandbox("okfit-sync-");
	const env = baseEnv(sandbox.env);
	await initRepo(sandbox.cwd, env);
	const init = await withServices(
		runOkfit(["init"], { cwd: sandbox.cwd, env: { ...env, OKFIT_NOW: "2026-09-01T00:00:00.000Z" } }),
	);
	assert.strictEqual(init.exitCode, 0);
	await commit(sandbox.cwd, { message: "okfit init", authoredAt: INIT_AUTHORED_AT }, env);
	return { sandbox, cwd: sandbox.cwd, env };
};

/** One `Decision` with a `generated.by` but no `at` -- FW fixture (a)'s shape, `locateGenerated`'s `insertAfterLastKey` path. */
const decisionWithGeneratedBy = (title: string, description: string): string =>
	[
		"---",
		"type: Decision",
		`title: ${title}`,
		`description: ${description}`,
		"generated:",
		"  by: human:ada",
		"status: draft",
		"---",
		"",
		`# ${title}`,
		"",
	].join("\n");

/** FW fixture (b)'s shape: a stale plain-scalar `at` that a replace must overwrite. */
const decisionWithPlainAt = (title: string, description: string, at: string): string =>
	[
		"---",
		"type: Decision",
		`title: ${title}`,
		`description: ${description}`,
		"generated:",
		"  by: human:ada",
		`  at: ${at}`,
		"status: draft",
		"---",
		"",
		`# ${title}`,
		"",
	].join("\n");

/** FW fixture (c)'s shape: a single-quoted `at` whose quote style a replace must preserve. */
const decisionWithQuotedAt = (title: string, description: string, at: string): string =>
	[
		"---",
		"type: Decision",
		`title: ${title}`,
		`description: ${description}`,
		"generated:",
		"  by: human:ada",
		`  at: '${at}'`,
		"status: draft",
		"---",
		"",
		`# ${title}`,
		"",
	].join("\n");

/** FW fixture (f)'s shape: a flow mapping, unsupported for write-back. */
const decisionWithFlowGenerated = (title: string, description: string): string =>
	[
		"---",
		"type: Decision",
		`title: ${title}`,
		`description: ${description}`,
		"generated: { by: human:ada }",
		"status: draft",
		"---",
		"",
		`# ${title}`,
		"",
	].join("\n");

const decisionPath = (cwd: string, name: string): string => join(cwd, "okf", "decisions", `${name}.md`);
const readDecision = (cwd: string, name: string): Promise<string> => readFile(decisionPath(cwd, name), "utf8");
const readIndex = (cwd: string, relative: string): Promise<string> => readFile(join(cwd, "okf", relative), "utf8");
const readLog = (cwd: string): Promise<string> => readFile(join(cwd, "okf", "log.md"), "utf8");

const writeAndCommitDecision = async (
	cwd: string,
	env: Record<string, string>,
	name: string,
	contents: string,
	authoredAt: string,
	message: string,
): Promise<string> => {
	await writeFile(decisionPath(cwd, name), contents, "utf8");
	return commit(cwd, { message, authoredAt }, env);
};

interface SyncModeEnvelope {
	readonly selected: boolean;
	readonly written: ReadonlyArray<string>;
	readonly unchanged: ReadonlyArray<string>;
	readonly skipped: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
}

interface SyncEnvelope {
	readonly schema: number;
	readonly okfit_version: string;
	readonly root: string;
	readonly dry_run: boolean;
	readonly exit_code: number;
	readonly generated: SyncModeEnvelope;
	readonly index: SyncModeEnvelope;
	readonly log: SyncModeEnvelope;
}

const parseEnvelope = (stdout: string): SyncEnvelope => JSON.parse(stdout) as SyncEnvelope;

describe("okfit sync (e2e)", () => {
	it("runs all three modes in fixed order and reports what each wrote", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				decisionWithGeneratedBy("Example decision", "One decision, freshly committed, generated.at unset."),
				"2026-09-02T00:00:00+00:00",
				"add example decision",
			);

			const run = await withServices(runOkfit(["sync", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.strictEqual(envelope.schema, 1);
			assert.match(String(envelope.okfit_version), /^\d+\.\d+\.\d+/);
			// `root` goes through `displayRoot`, which renders a path relative to
			// cwd whenever the target is under it (verified against
			// `render/human.ts#displayRoot` and every existing validate.e2e.test.ts
			// case) -- discrepancy from the task brief's own draft, which expected
			// the absolute path here (see task report).
			assert.strictEqual(envelope.root, "okf");
			assert.strictEqual(envelope.dry_run, false);
			assert.strictEqual(envelope.exit_code, 0);

			// generated: the new decision's `at` is inserted; project.md has no
			// `generated` block at all (init's own scaffold) so it is skipped,
			// never substituted with `now`.
			assert.strictEqual(envelope.generated.selected, true);
			assert.deepStrictEqual(envelope.generated.written, ["decisions/example"]);
			assert.deepStrictEqual(envelope.generated.unchanged, []);
			assert.deepStrictEqual(envelope.generated.skipped, [{ id: "project", reason: "generated-missing" }]);

			// index: only decisions/index.md changes (its first entry); root
			// index.md's own rendered bytes are untouched (S-20 -- the four
			// still-empty directories are never iterated at all).
			assert.strictEqual(envelope.index.selected, true);
			assert.deepStrictEqual(envelope.index.written, ["decisions/index.md"]);
			assert.deepStrictEqual(envelope.index.unchanged, ["index.md"]);

			// log: one new Added item, dated after the init commit's own logged
			// date, opens a brand-new newest-first group.
			assert.strictEqual(envelope.log.selected, true);
			assert.deepStrictEqual(envelope.log.written, ["log.md"]);

			assert.strictEqual(
				await readIndex(cwd, "decisions/index.md"),
				"# Decision\n\n* [Example decision](example.md) - One decision, freshly committed, generated.at unset.\n",
			);
			assert.strictEqual(
				await readLog(cwd),
				"# Log\n\n## 2026-09-02\n\n* Added Example decision\n\n## 2026-09-01\n\n* Initialized the bundle with the software-project profile\n",
			);
			assert.isTrue(
				(await readDecision(cwd, "example")).includes("generated:\n  by: human:ada\n  at: 2026-09-02T00:00:00Z\n"),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--only generated runs the generated mode alone; index and log stay unselected with empty lists", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				decisionWithGeneratedBy("Example decision", "Exercises --only generated alone."),
				"2026-09-02T00:00:00+00:00",
				"add example decision",
			);
			const before = { index: await readIndex(cwd, "decisions/index.md"), log: await readLog(cwd) };

			const run = await withServices(runOkfit(["sync", "--only", "generated", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.strictEqual(envelope.generated.selected, true);
			assert.deepStrictEqual(envelope.generated.written, ["decisions/example"]);
			assert.deepStrictEqual(envelope.index, { selected: false, written: [], unchanged: [], skipped: [] });
			assert.deepStrictEqual(envelope.log, { selected: false, written: [], unchanged: [], skipped: [] });

			assert.strictEqual(await readIndex(cwd, "decisions/index.md"), before.index);
			assert.strictEqual(await readLog(cwd), before.log);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--only index runs the index mode alone", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				decisionWithGeneratedBy("Example decision", "Exercises --only index alone."),
				"2026-09-02T00:00:00+00:00",
				"add example decision",
			);

			const run = await withServices(runOkfit(["sync", "--only", "index", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.deepStrictEqual(envelope.generated, { selected: false, written: [], unchanged: [], skipped: [] });
			assert.strictEqual(envelope.index.selected, true);
			assert.deepStrictEqual(envelope.index.written, ["decisions/index.md"]);
			assert.deepStrictEqual(envelope.log, { selected: false, written: [], unchanged: [], skipped: [] });

			// generated.at is left exactly as committed: still `by` only.
			assert.isTrue((await readDecision(cwd, "example")).includes("generated:\n  by: human:ada\nstatus: draft\n"));
			assert.strictEqual(
				await readLog(cwd),
				"## 2026-09-01\n\n* Initialized the bundle with the software-project profile\n",
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--only log runs the log mode alone", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				decisionWithGeneratedBy("Example decision", "Exercises --only log alone."),
				"2026-09-02T00:00:00+00:00",
				"add example decision",
			);

			const run = await withServices(runOkfit(["sync", "--only", "log", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.deepStrictEqual(envelope.generated, { selected: false, written: [], unchanged: [], skipped: [] });
			assert.deepStrictEqual(envelope.index, { selected: false, written: [], unchanged: [], skipped: [] });
			assert.strictEqual(envelope.log.selected, true);
			assert.deepStrictEqual(envelope.log.written, ["log.md"]);

			assert.strictEqual(await readIndex(cwd, "decisions/index.md"), "# Decisions\n");
			assert.isTrue((await readDecision(cwd, "example")).includes("generated:\n  by: human:ada\nstatus: draft\n"));
			assert.strictEqual(
				await readLog(cwd),
				"# Log\n\n## 2026-09-02\n\n* Added Example decision\n\n## 2026-09-01\n\n* Initialized the bundle with the software-project profile\n",
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--only generated --only index runs two modes, log unselected", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				decisionWithGeneratedBy("Example decision", "Exercises two repeated --only flags."),
				"2026-09-02T00:00:00+00:00",
				"add example decision",
			);

			const run = await withServices(
				runOkfit(["sync", "--only", "generated", "--only", "index", "--format", "json"], { cwd, env }),
			);
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.strictEqual(envelope.generated.selected, true);
			assert.deepStrictEqual(envelope.generated.written, ["decisions/example"]);
			assert.strictEqual(envelope.index.selected, true);
			assert.deepStrictEqual(envelope.index.written, ["decisions/index.md"]);
			assert.deepStrictEqual(envelope.log, { selected: false, written: [], unchanged: [], skipped: [] });

			assert.strictEqual(
				await readLog(cwd),
				"## 2026-09-01\n\n* Initialized the bundle with the software-project profile\n",
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--dry-run computes every result and writes nothing, byte-identical before and after", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				decisionWithGeneratedBy("Example decision", "Exercises --dry-run."),
				"2026-09-02T00:00:00+00:00",
				"add example decision",
			);
			const before = {
				example: await readDecision(cwd, "example"),
				index: await readIndex(cwd, "decisions/index.md"),
				log: await readLog(cwd),
			};

			const run = await withServices(runOkfit(["sync", "--dry-run", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.strictEqual(envelope.dry_run, true);
			assert.deepStrictEqual(envelope.generated.written, ["decisions/example"]);
			assert.deepStrictEqual(envelope.index.written, ["decisions/index.md"]);
			assert.deepStrictEqual(envelope.log.written, ["log.md"]);

			assert.strictEqual(await readDecision(cwd, "example"), before.example);
			assert.strictEqual(await readIndex(cwd, "decisions/index.md"), before.index);
			assert.strictEqual(await readLog(cwd), before.log);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("a dirty concept body is skipped with reason dirty; generated.at is left untouched", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const contents = decisionWithGeneratedBy("Dirty decision", "Committed, then dirtied before sync runs.");
			await writeAndCommitDecision(cwd, env, "dirty", contents, "2026-09-02T00:00:00+00:00", "add dirty decision");
			// Dirty detection (`Derivation.body`) compares only the text AFTER the
			// frontmatter's closing `---`; editing `description` alone (as the
			// task brief's own draft did here) never registers as dirty. Editing
			// the BODY is what this case actually needs to exercise -- discrepancy
			// from the brief (see task report).
			const dirtied = contents.replace("# Dirty decision\n", "# Dirty decision\n\nEdited after commit, before sync.\n");
			await writeFile(decisionPath(cwd, "dirty"), dirtied, "utf8");

			const run = await withServices(runOkfit(["sync", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.isTrue(
				envelope.generated.skipped.some((entry) => entry.id === "decisions/dirty" && entry.reason === "dirty"),
			);
			assert.isFalse(envelope.generated.written.includes("decisions/dirty"));
			assert.strictEqual(await readDecision(cwd, "dirty"), dirtied);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("an untracked concept body is skipped with reason untracked", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const contents = decisionWithGeneratedBy("Untracked decision", "Never staged or committed.");
			await writeFile(decisionPath(cwd, "untracked"), contents, "utf8");

			const run = await withServices(runOkfit(["sync", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.isTrue(
				envelope.generated.skipped.some((entry) => entry.id === "decisions/untracked" && entry.reason === "untracked"),
			);
			assert.strictEqual(await readDecision(cwd, "untracked"), contents);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("a concept with no generated block is skipped with reason generated-missing", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const run = await withServices(runOkfit(["sync", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.deepStrictEqual(envelope.generated.written, []);
			assert.deepStrictEqual(envelope.generated.unchanged, []);
			assert.deepStrictEqual(envelope.generated.skipped, [{ id: "project", reason: "generated-missing" }]);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("a concept whose generated is a flow mapping is skipped with reason generated-unsupported", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const contents = decisionWithFlowGenerated(
				"Flow decision",
				"generated is a flow mapping; unsupported for write-back.",
			);
			await writeAndCommitDecision(cwd, env, "flow", contents, "2026-09-02T00:00:00+00:00", "add flow decision");

			const run = await withServices(runOkfit(["sync", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const envelope = parseEnvelope(run.stdout);

			assert.isTrue(
				envelope.generated.skipped.some(
					(entry) => entry.id === "decisions/flow" && entry.reason === "generated-unsupported",
				),
			);
			assert.strictEqual(await readDecision(cwd, "flow"), contents);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("inserts at after by when generated has no at key", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const contents = decisionWithGeneratedBy("Insert decision", "Exercises the insertAfterLastKey path directly.");
			await writeAndCommitDecision(cwd, env, "insert", contents, "2026-09-02T00:00:00+00:00", "add insert decision");

			const run = await withServices(runOkfit(["sync", "--only", "generated"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);

			const digest = await digestOf(contents);
			assert.strictEqual(
				await readDecision(cwd, "insert"),
				contents.replace(
					"generated:\n  by: human:ada\n",
					`generated:\n  by: human:ada\n  at: 2026-09-02T00:00:00Z\n  body_sha256: ${digest}\n`,
				),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("replaces a plain-scalar at that differs from the derived instant, and reports unchanged once it matches", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const contents = decisionWithPlainAt(
				"Plain at decision",
				"generated.at is stale and must be replaced.",
				"2020-01-01T00:00:00Z",
			);
			await writeAndCommitDecision(cwd, env, "plain", contents, "2026-09-03T00:00:00+00:00", "add plain-at decision");

			const first = await withServices(runOkfit(["sync", "--only", "generated", "--format", "json"], { cwd, env }));
			assert.strictEqual(first.exitCode, 0);
			assert.deepStrictEqual(parseEnvelope(first.stdout).generated.written, ["decisions/plain"]);
			const digest = await digestOf(contents);
			assert.strictEqual(
				await readDecision(cwd, "plain"),
				contents.replace("  at: 2020-01-01T00:00:00Z\n", `  at: 2026-09-03T00:00:00Z\n  body_sha256: ${digest}\n`),
			);

			const second = await withServices(runOkfit(["sync", "--only", "generated", "--format", "json"], { cwd, env }));
			assert.strictEqual(second.exitCode, 0);
			assert.deepStrictEqual(parseEnvelope(second.stdout).generated.written, []);
			assert.deepStrictEqual(parseEnvelope(second.stdout).generated.unchanged, ["decisions/plain"]);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("preserves a quoted at's quote style on replace", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const contents = decisionWithQuotedAt(
				"Quoted at decision",
				"generated.at is single-quoted; the replacement keeps the quote.",
				"2020-01-01T00:00:00Z",
			);
			await writeAndCommitDecision(cwd, env, "quoted", contents, "2026-09-04T00:00:00+00:00", "add quoted-at decision");

			const run = await withServices(runOkfit(["sync", "--only", "generated"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);

			const digest = await digestOf(contents);
			assert.strictEqual(
				await readDecision(cwd, "quoted"),
				contents.replace("  at: '2020-01-01T00:00:00Z'\n", `  at: '2026-09-04T00:00:00Z'\n  body_sha256: ${digest}\n`),
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("index mode writes a directory's index.md only when the rendered bytes differ from disk", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				decisionWithGeneratedBy("Example decision", "Exercises the write-only-on-diff property."),
				"2026-09-02T00:00:00+00:00",
				"add example decision",
			);

			const first = await withServices(runOkfit(["sync", "--only", "index", "--format", "json"], { cwd, env }));
			assert.strictEqual(first.exitCode, 0);
			assert.deepStrictEqual(parseEnvelope(first.stdout).index.written, ["decisions/index.md"]);

			const second = await withServices(runOkfit(["sync", "--only", "index", "--format", "json"], { cwd, env }));
			assert.strictEqual(second.exitCode, 0);
			assert.deepStrictEqual(parseEnvelope(second.stdout).index.written, []);
			// The root index.md is re-confirmed unchanged on every run (its own
			// bytes never changed), not merely the directory whose contents
			// actually differed -- discrepancy from the task brief's own draft,
			// which omitted "index.md" here (see task report).
			assert.deepStrictEqual(parseEnvelope(second.stdout).index.unchanged, ["index.md", "decisions/index.md"]);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("log mode adds one Added item for a newly committed concept and one Updated item for a later body change, newest first", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			// The "Updated" half of this case needs the BODY (post-frontmatter
			// text) to actually change between commits: `Derivation.generatedAt`'s
			// dirty/change detection (`Derivation.body`) compares only that text,
			// never the frontmatter `description` field the task brief's own
			// draft revised here (see task report).
			const original = decisionWithGeneratedBy("Example decision", "First committed body.").replace(
				"# Example decision\n",
				"# Example decision\n\nOriginal body text.\n",
			);
			await writeAndCommitDecision(cwd, env, "example", original, "2026-09-02T00:00:00+00:00", "add example decision");

			const first = await withServices(runOkfit(["sync", "--only", "log", "--format", "json"], { cwd, env }));
			assert.strictEqual(first.exitCode, 0);
			assert.deepStrictEqual(parseEnvelope(first.stdout).log.written, ["log.md"]);
			assert.strictEqual(
				await readLog(cwd),
				"# Log\n\n## 2026-09-02\n\n* Added Example decision\n\n## 2026-09-01\n\n* Initialized the bundle with the software-project profile\n",
			);

			const revised = original.replace("Original body text.", "Revised body text, same title.");
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				revised,
				"2026-09-03T00:00:00+00:00",
				"revise example decision body",
			);

			const second = await withServices(runOkfit(["sync", "--only", "log", "--format", "json"], { cwd, env }));
			assert.strictEqual(second.exitCode, 0);
			assert.deepStrictEqual(parseEnvelope(second.stdout).log.written, ["log.md"]);
			assert.strictEqual(
				await readLog(cwd),
				"# Log\n\n## 2026-09-03\n\n* Updated Example decision\n\n## 2026-09-02\n\n* Added Example decision\n\n## 2026-09-01\n\n* Initialized the bundle with the software-project profile\n",
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("log mode leaves an existing group's hand-written prose byte-identical when merging a new item for a different date", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			await writeAndCommitDecision(
				cwd,
				env,
				"example",
				decisionWithGeneratedBy("Example decision", "First committed body."),
				"2026-09-02T00:00:00+00:00",
				"add example decision",
			);
			const first = await withServices(runOkfit(["sync", "--only", "log"], { cwd, env }));
			assert.strictEqual(first.exitCode, 0);

			// A hand-written line under the 2026-09-02 group, added directly to
			// log.md (a reserved file, never dirty-checked as a concept).
			const withHandwrittenNote = (await readLog(cwd)).replace(
				"* Added Example decision\n",
				"* Added Example decision\n* A note someone wrote by hand\n",
			);
			await writeFile(join(cwd, "okf", "log.md"), withHandwrittenNote, "utf8");

			await writeAndCommitDecision(
				cwd,
				env,
				"second",
				decisionWithGeneratedBy("Second decision", "Committed on a later date."),
				"2026-09-03T00:00:00+00:00",
				"add second decision",
			);

			const second = await withServices(runOkfit(["sync", "--only", "log", "--format", "json"], { cwd, env }));
			assert.strictEqual(second.exitCode, 0);
			assert.deepStrictEqual(parseEnvelope(second.stdout).log.written, ["log.md"]);

			assert.strictEqual(
				await readLog(cwd),
				"# Log\n\n## 2026-09-03\n\n* Added Second decision\n\n## 2026-09-02\n\n* Added Example decision\n* A note someone wrote by hand\n\n## 2026-09-01\n\n* Initialized the bundle with the software-project profile\n",
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("exits 3 outside a git repository", async () => {
		const sandbox = await makeSandbox("okfit-sync-nogit-");
		try {
			const env = baseEnv(sandbox.env);
			const init = await withServices(
				runOkfit(["init"], { cwd: sandbox.cwd, env: { ...env, OKFIT_NOW: "2026-09-01T00:00:00.000Z" } }),
			);
			assert.strictEqual(init.exitCode, 0);
			// No `initRepo` call: `sandbox.cwd` has no `.git` at all.

			const run = await withServices(runOkfit(["sync"], { cwd: sandbox.cwd, env }));
			assert.strictEqual(run.exitCode, 3);
			assert.isTrue(run.stderr.includes("error: NotARepositoryError: not a git repository:"));
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("exits 64 on an unknown --only mode", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			const run = await withServices(runOkfit(["sync", "--only", "bogus"], { cwd, env }));
			// bin-version.e2e.test.ts's own "an unknown flag exits 64" precedent
			// asserts only the exit code -- neither the exact ShowHelp wording
			// nor its stderr shape is pinned anywhere else in this codebase.
			assert.strictEqual(run.exitCode, 64);
		} finally {
			await removeSandbox(sandbox);
		}
	});

	it("--format json prints the SyncEnvelope with three per-mode blocks", async () => {
		const { sandbox, cwd, env } = await seeded();
		try {
			// Zero new commits since `okfit init`: the only deterministic drift
			// is log.md's own title normalization (see this task's "Known
			// algorithm facts" note) -- a fully computable envelope with no
			// extra fixture setup.
			const run = await withServices(runOkfit(["sync", "--dry-run", "--format", "json"], { cwd, env }));
			assert.strictEqual(run.exitCode, 0);
			const { okfit_version: reportedVersion, ...envelope } = parseEnvelope(run.stdout);
			assert.match(String(reportedVersion), /^\d+\.\d+\.\d+/);

			assert.deepStrictEqual(envelope, {
				schema: 1,
				root: "okf",
				dry_run: true,
				exit_code: 0,
				generated: {
					selected: true,
					written: [],
					unchanged: [],
					skipped: [{ id: "project", reason: "generated-missing" }],
				},
				index: { selected: true, written: [], unchanged: ["index.md"], skipped: [] },
				log: { selected: true, written: ["log.md"], unchanged: [], skipped: [] },
			});

			// --dry-run: the file on disk is untouched, still headerless.
			assert.strictEqual(
				await readLog(cwd),
				"## 2026-09-01\n\n* Initialized the bundle with the software-project profile\n",
			);
		} finally {
			await removeSandbox(sandbox);
		}
	});
});
