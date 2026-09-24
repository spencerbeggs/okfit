import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";
import { Effect } from "effect";
import { stripComments } from "./utils/boundaries.js";

const SRC_ROOT = join(import.meta.dirname, "..", "src");

const walk = (dir: string): ReadonlyArray<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return walk(full);
		return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
	});

const sources = (): ReadonlyArray<{ readonly file: string; readonly code: string }> =>
	walk(SRC_ROOT).map((file) => ({ file: relative(SRC_ROOT, file), code: stripComments(readFileSync(file, "utf8")) }));

/**
 * `main.ts` passes `process.stdin`/`process.stdout` as `streams` to
 * `makeReferenceTransport` (the controller ruling in `protocol/reference.ts`'s
 * TSDoc): the transport, not this file, ever calls `.write` on them. This
 * allowlist exempts ONLY that bare-reference form (`STDOUT_BARE_REFERENCE`
 * below) for `main.ts`. It does NOT exempt `main.ts` from
 * `STDOUT_WRITE_CALL`, which is checked in every file with no allowlist at
 * all -- a `process.stdout.write(...)` (or any other method call on
 * `process.stdout`) added to `main.ts` itself must still fail this test.
 */
const MAY_REFERENCE_STDOUT = new Set(["main.ts"]);

/** `process.stdout.<anything>(...)` -- an actual call, never just allowlisted. */
const STDOUT_WRITE_CALL = /\bprocess\s*\.\s*stdout\s*\.\s*\w+\s*\(/;
/** A bare `process.stdout` reference, method call or not; `main.ts` alone may pass this one, as an object. */
const STDOUT_BARE_REFERENCE = /\bprocess\s*\.\s*stdout\b/;
/**
 * `console.error` is deliberately NOT in this list: unlike `log`/`info`/
 * `debug`/`table`, Node routes `console.error` to STDERR, never the wire, so
 * this package's actual policy is "no stdout writes", not "no console at
 * all". `@effected/workspaces/testing`'s `SourceBoundary` ships a
 * `"console-write"` rule, but it forbids ANY reference to the global
 * `console` -- coarser than this package's real policy and would flag a
 * legitimate future `console.error` -- so this check stays hand-rolled.
 */
const CONSOLE_WRITE = /\bconsole\s*\.\s*(log|info|debug|table)\s*\(/;

/**
 * Only the reference transport and the process entry may see the library.
 * protocol/types.ts is type-only: `export type` re-exports of the protocol
 * types, erased at build, so importing it never loads the library.
 */
const MAY_IMPORT_LIBRARY = new Set(["protocol/reference.ts", "main.ts", "protocol/types.ts"]);

describe("@okfit/lsp boundaries", () => {
	// `@effected/workspaces/testing`'s `SourceBoundary` replaces the
	// `process`-read half of this suite (`"process"` and `"node:process"`
	// together cover both a bare `process.` access and every import form
	// that reaches the `node:process` module -- exactly what this package's
	// own former hand-rolled `PROCESS_MODULE_IMPORT` regex existed for).
	// `version.ts` needs no `allow` entry: SourceBoundary's `process` rule
	// exempts `process.env.__PACKAGE_VERSION__` unconditionally.
	it.effect("no file under src/ reads `process`, in any form, except bin.ts and main.ts", () =>
		Effect.gen(function* () {
			const fixtureFailures = SourceBoundary.verifyFixtures();
			assert.deepStrictEqual(fixtureFailures, []);
			const scan = yield* SourceBoundary.scan({
				root: SRC_ROOT,
				rules: ["process", "node:process"],
				allow: ["bin.ts", "main.ts"],
			});
			// Non-vacuity: an empty `root` glob or a typo'd path would
			// otherwise report a spotless boundary because nothing was
			// scanned at all.
			assert.isAbove(scan.files.length, 0);
			assert.deepStrictEqual(scan.violations, []);
		}).pipe(Effect.provide(NodeServices.layer)),
	);

	// A positive control, over the raw scanner (no filesystem): proves the
	// two rules discriminate a real disallowed read/import from an
	// allowlisted one, rather than the scan above passing vacuously.
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

	const all = sources();

	it("no file under src/ writes to stdout: no process.stdout, console.log/info/debug/table", () => {
		const offenders = all
			.filter(
				({ file, code }) =>
					STDOUT_WRITE_CALL.test(code) ||
					(!MAY_REFERENCE_STDOUT.has(file) && STDOUT_BARE_REFERENCE.test(code)) ||
					CONSOLE_WRITE.test(code),
			)
			.map(({ file }) => file);
		assert.deepStrictEqual(offenders, []);
	});

	it("only protocol/reference.ts, main.ts and the type-only protocol/types.ts import vscode-languageserver", () => {
		const offenders = all
			.filter(({ file, code }) => !MAY_IMPORT_LIBRARY.has(file) && /from\s*["']vscode-languageserver/.test(code))
			.map(({ file }) => file);
		assert.deepStrictEqual(offenders, []);
	});

	it("the scanner catches a stdout write (positive control)", () => {
		assert.isTrue(CONSOLE_WRITE.test(stripComments("const x = 1; console.log(x);")));
		assert.isFalse(CONSOLE_WRITE.test(stripComments("// console.log(x)\nconsole.error(1);")));
	});

	it("STDOUT_WRITE_CALL catches a process.stdout method call even where a bare reference is allowlisted (positive control)", () => {
		assert.isTrue(STDOUT_WRITE_CALL.test(stripComments('process.stdout.write("x");')));
		assert.isFalse(STDOUT_WRITE_CALL.test(stripComments("const streams = { output: process.stdout };")));
	});
});
