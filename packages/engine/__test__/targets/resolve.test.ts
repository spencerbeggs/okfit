import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Bundle } from "@okfit/core";
import { Effect, Exit } from "effect";
import { Targets } from "../../src/targets/resolve.js";

const concept = (title: string): string => `---\ntype: Decision\ntitle: ${title}\n---\n\n# ${title}\n`;

const withBundle = <A, E>(body: (dir: string, okf: string) => Effect.Effect<A, E, NodeServices.NodeServices>) =>
	Effect.gen(function* () {
		const dir = yield* Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), "okfit-targets-"))));
		const okf = join(dir, "okf");
		yield* Effect.promise(async () => {
			await mkdir(join(okf, "decisions"), { recursive: true });
			await mkdir(join(okf, "conventions"), { recursive: true });
			await writeFile(join(okf, "decisions", "foo.md"), concept("Foo"));
			await writeFile(join(okf, "decisions", "bar.md"), concept("Bar"));
			await writeFile(join(okf, "foo.md"), concept("Root foo"));
			await writeFile(join(okf, "conventions", "rule.md"), concept("Rule"));
			await writeFile(join(okf, "index.md"), "# Index\n");
			await writeFile(join(okf, "broken.md"), "---\ntitle: [unclosed\n---\n");
			await writeFile(join(dir, "outside.md"), concept("Outside"));
		});
		return yield* body(dir, okf).pipe(Effect.ensuring(Effect.promise(() => rm(dir, { recursive: true, force: true }))));
	}).pipe(Effect.provide(NodeServices.layer));

const resolveIds = (args: ReadonlyArray<string>, okf: string, cwd: string, files = false) =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: okf });
		const targets = yield* Targets.resolve(args, bundle, cwd, { files });
		return targets.map((t) => t.path);
	});

/** The error a resolution fails with; fails the test if it resolved. */
const errorOf = (args: ReadonlyArray<string>, okf: string, cwd: string) =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: okf });
		const exit = yield* Effect.exit(Targets.resolve(args, bundle, cwd));
		const error = Exit.findErrorOption(exit);
		assert.isTrue(error._tag === "Some");
		return error._tag === "Some" && error.value._tag === "TargetResolutionError" ? error.value : undefined;
	});

describe("Targets.resolve", () => {
	it.effect("resolves an absolute path, a cwd-relative path and an id, in argument order", () =>
		withBundle((dir, okf) =>
			Effect.gen(function* () {
				const paths = yield* resolveIds(
					[join(okf, "decisions", "bar.md"), "okf/conventions/rule.md", "decisions/foo"],
					okf,
					dir,
				);
				assert.deepStrictEqual(paths, ["decisions/bar.md", "conventions/rule.md", "decisions/foo.md"]);
			}),
		),
	);

	it.effect("tolerates a leading slash and a trailing .md on an id", () =>
		withBundle((dir, okf) =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* resolveIds(["/decisions/foo.md"], okf, dir), ["decisions/foo.md"]);
			}),
		),
	);

	it.effect("collapses duplicates to the first spelling", () =>
		withBundle((dir, okf) =>
			Effect.gen(function* () {
				const paths = yield* resolveIds(["decisions/foo", "okf/decisions/foo.md", "/decisions/foo.md"], okf, dir);
				assert.deepStrictEqual(paths, ["decisions/foo.md"]);
			}),
		),
	);

	it.effect("discards a candidate outside the bundle instead of matching it", () =>
		withBundle((dir, okf) =>
			Effect.gen(function* () {
				const error = yield* errorOf([join(dir, "outside.md")], okf, dir);
				assert.deepStrictEqual(error?.failures, [{ arg: join(dir, "outside.md"), reason: "outside-bundle" }]);
			}),
		),
	);

	it.effect("reports an ambiguous target when the cwd-relative file and the id are different concepts", () =>
		withBundle((_dir, okf) =>
			Effect.gen(function* () {
				const error = yield* errorOf(["foo.md"], okf, join(okf, "decisions"));
				assert.deepStrictEqual(error?.failures, [
					{ arg: "foo.md", reason: "ambiguous", candidates: ["decisions/foo.md", "foo.md"] },
				]);
			}),
		),
	);

	it.effect("resolves a cwd-relative file inside a bundle subdirectory when no id competes", () =>
		withBundle((_dir, okf) =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* resolveIds(["bar.md"], okf, join(okf, "decisions")), ["decisions/bar.md"]);
			}),
		),
	);

	it.effect("reports every bad argument at once, with a suggestion where one exists", () =>
		withBundle((dir, okf) =>
			Effect.gen(function* () {
				const error = yield* errorOf(["decisions/foo", "decisions/fooo", "nothing-like-it", "index"], okf, dir);
				assert.deepStrictEqual(error?.failures, [
					{ arg: "decisions/fooo", reason: "not-found", suggestion: "decisions/foo" },
					{ arg: "nothing-like-it", reason: "not-found" },
					{ arg: "index", reason: "reserved" },
				]);
				assert.strictEqual(
					error?.message,
					[
						'no concept "decisions/fooo" (did you mean decisions/foo?)',
						'no concept "nothing-like-it"',
						'"index" is a reserved file, not a concept',
					].join("\n"),
				);
			}),
		),
	);

	it.effect("suggests by basename before edit distance", () =>
		withBundle((_dir, okf) =>
			Effect.gen(function* () {
				const bundle = yield* Bundle.load({ root: okf });
				assert.strictEqual(Targets.suggest("rule", bundle), "conventions/rule");
			}),
		),
	);

	it.effect("rejects an undecodable file as a concept, but accepts it (and index.md) with files: true", () =>
		withBundle((dir, okf) =>
			Effect.gen(function* () {
				const error = yield* errorOf(["broken"], okf, dir);
				assert.deepStrictEqual(error?.failures, [{ arg: "broken", reason: "not-a-concept" }]);
				const bundle = yield* Bundle.load({ root: okf });
				const files = yield* Targets.resolve(["okf/broken.md", "okf/index.md"], bundle, dir, { files: true });
				assert.deepStrictEqual(
					files.map((t) => [t.path, t.id]),
					[
						["broken.md", undefined],
						["index.md", undefined],
					],
				);
			}),
		),
	);

	it.effect("compares real paths: a symlinked cwd still lands inside the bundle", () =>
		withBundle((dir, okf) =>
			Effect.gen(function* () {
				const link = `${dir}-link`;
				yield* Effect.promise(() => symlink(dir, link));
				return yield* Effect.gen(function* () {
					assert.deepStrictEqual(yield* resolveIds(["okf/decisions/bar.md"], okf, link), ["decisions/bar.md"]);
				}).pipe(Effect.ensuring(Effect.promise(() => rm(link, { force: true }))));
			}),
		),
	);
});
