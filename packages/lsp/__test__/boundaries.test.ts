import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

/** Reads one `src/`-relative file's raw text, for computing an expected waiver below. */
const readSrc = (file: string): string => readFileSync(join(SRC_ROOT, file), "utf8");

describe("@okfit/lsp boundaries", () => {
	/**
	 * `@effected/workspaces/testing`'s `SourceBoundary` now expresses this
	 * package's whole `src/` boundary (`CLAUDE.md`'s Rules section) in ONE
	 * scan, where round 2 could only fold in the `process`/`node:process`
	 * half (`allow` exempts a file from every rule, and the old `"console-write"`
	 * rule banned `console.error` outright -- see the round-2 report). Two
	 * additions from the kit close both gaps:
	 *
	 * - `allowRules` (not `allow`) waives one NAMED rule per file, leaving
	 *   every other rule still enforced on it. `main.ts` is exempt from
	 *   `process`/`node:process` (it owns the process boundary) but stays
	 *   checked for `stdout-write`/`console-stdout` like every other file --
	 *   `allow` could not express that split, since it would have exempted
	 *   `main.ts` from a stray `console.log` or `.write()` call too.
	 * - `"console-stdout"` spares a member access to `console.error`/`.warn`/
	 *   `.trace`/`.assert` (Node's own stderr-routed methods), where the old
	 *   `"console-write"` (now just `"console"`) forbade the global outright.
	 *   This package's own policy only needs `.error` spared; the extra three
	 *   are simply never triggered by anything under `src/` (confirmed below
	 *   by this scan's own `scan.violations` staying empty).
	 *
	 * `"stdout-write"` itself needs no `allowRules` entry for `main.ts`'s bare
	 * `process.stdout` handle (passed to `makeReferenceTransport` as a stream
	 * object): it flags an actual `<name>.write(` call, in any form, and never
	 * a bare reference -- so "may hold the handle, must never call `.write()`
	 * on it" falls out of the rule's own definition with nothing to waive.
	 *
	 * This also folds in the former hand-rolled "only these three files import
	 * `vscode-languageserver`" check as `{ forbidImports: ["vscode-languageserver"] }`
	 * with its own `allowRules.forbidImports` entry -- `forbidImports` matches a
	 * specifier that equals an entry OR is a subpath of one, so it catches both
	 * the bare `"vscode-languageserver"` import and the `"vscode-languageserver/node"`
	 * subpath `protocol/reference.ts` uses, and (per `SourceBoundary.importSpecifiers`)
	 * a type-only import too, which is why `protocol/types.ts` needs the same
	 * waiver despite never loading the library at runtime.
	 *
	 * Nothing in this package's boundary is left inexpressible: every hand-rolled
	 * check round 2 (and the original suite) carried is now one `SourceBoundary.scan`
	 * call plus the positive controls below, which prove the rules discriminate
	 * rather than pass vacuously.
	 */
	it.effect("expresses this package's whole src/ boundary in one scan", () =>
		Effect.gen(function* () {
			const fixtureFailures = SourceBoundary.verifyFixtures();
			assert.deepStrictEqual(fixtureFailures, []);

			const scan = yield* SourceBoundary.scan({
				root: SRC_ROOT,
				rules: [
					"process",
					"node:process",
					"stdout-write",
					"console-stdout",
					{ forbidImports: ["vscode-languageserver"] },
				],
				allowRules: {
					process: ["bin.ts", "main.ts"],
					"node:process": ["bin.ts", "main.ts"],
					forbidImports: ["protocol/reference.ts", "main.ts", "protocol/types.ts"],
				},
			});

			// Non-vacuity: an empty `root` glob or a typo'd path would otherwise
			// report a spotless boundary because nothing was scanned at all.
			assert.isAbove(scan.files.length, 0);
			assert.deepStrictEqual(scan.violations, []);

			// The waiver can't go stale silently: pin exactly what it waives,
			// computed from the allowlisted files' own text rather than a
			// hardcoded line/column list, so a real edit to any of their
			// process reads or library imports moves this expectation in
			// lockstep -- while still failing the moment `allowRules` starts
			// waiving a `stdout-write` or `console-stdout` offence it never
			// should (neither rule has an `allowRules` entry above, so any
			// such offence would show up in `scan.violations` instead, which
			// the assertion above already pins to `[]`).
			const expectedWaived = [
				...(["bin.ts", "main.ts"] as const).flatMap((file) =>
					SourceBoundary.check(file, readSrc(file), ["process", "node:process"]),
				),
				...(["protocol/reference.ts", "main.ts", "protocol/types.ts"] as const).flatMap((file) =>
					SourceBoundary.check(file, readSrc(file), [{ forbidImports: ["vscode-languageserver"] }]),
				),
			].map((offence) => offence.label);
			assert.isAbove(expectedWaived.length, 0);
			assert.deepStrictEqual(scan.waived.map((offence) => offence.label).toSorted(), expectedWaived.toSorted());
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	// Positive controls, over the raw scanner (no filesystem): each proves its
	// rule discriminates a real disallowed read/write/import from an
	// allowlisted or spared one, rather than the scan above passing vacuously.

	it("SourceBoundary.check flags a bare process read and any node:process import outside the allowlist", () => {
		assert.isAbove(SourceBoundary.check("features/hover.ts", "const x = process.argv;", ["process"]).length, 0);
		assert.isAbove(
			SourceBoundary.check("features/hover.ts", 'import { env } from "node:process";', ["node:process"]).length,
			0,
		);
		assert.deepStrictEqual(
			SourceBoundary.check("version.ts", 'process.env.__PACKAGE_VERSION__ ?? "0.0.0";', ["process"]),
			[],
		);
	});

	it("SourceBoundary.check flags a stdout.write call, in any form, but spares a bare process.stdout reference", () => {
		assert.isAbove(SourceBoundary.check("main.ts", 'process.stdout.write("x");', ["stdout-write"]).length, 0);
		assert.isAbove(
			SourceBoundary.check("features/hover.ts", "const { stdout } = process; stdout.write(x);", ["stdout-write"])
				.length,
			0,
		);
		assert.deepStrictEqual(
			SourceBoundary.check("main.ts", "const streams = { output: process.stdout };", ["stdout-write"]),
			[],
		);
	});

	it("SourceBoundary.check flags console.log/info/debug/table and a bare console reference, but spares console.error", () => {
		assert.isAbove(SourceBoundary.check("features/hover.ts", "console.log(1);", ["console-stdout"]).length, 0);
		assert.isAbove(SourceBoundary.check("features/hover.ts", "const c = console;", ["console-stdout"]).length, 0);
		assert.deepStrictEqual(SourceBoundary.check("features/hover.ts", "console.error(1);", ["console-stdout"]), []);
	});

	it("SourceBoundary.check flags a vscode-languageserver import (and its subpaths) with no file-level exception -- only `scan`'s allowRules waives it", () => {
		assert.isAbove(
			SourceBoundary.check("features/hover.ts", 'import { Connection } from "vscode-languageserver";', [
				{ forbidImports: ["vscode-languageserver"] },
			]).length,
			0,
		);
		assert.isAbove(
			SourceBoundary.check("protocol/reference.ts", 'import { createConnection } from "vscode-languageserver/node";', [
				{ forbidImports: ["vscode-languageserver"] },
			]).length,
			0,
		);
	});
});
