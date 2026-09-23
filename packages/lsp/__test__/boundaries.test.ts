import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { assert, describe, it } from "@effect/vitest";
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

/** `process.env.__PACKAGE_VERSION__` in version.ts is a build-time constant; bin.ts and main.ts own the process. */
const MAY_READ_PROCESS = new Set(["bin.ts", "main.ts", "version.ts"]);

/**
 * Any form that reaches the `node:process` module: a bare `process.` access
 * (the pattern above) does not require it, since `import process from
 * "node:process"` binds the local name `process` and a later
 * `process.stdout` would already trip that scanner -- but a default import,
 * a namespace import, a named import (`import { env } from "node:process"`,
 * which never writes the identifier `process` at all) and `require` all
 * pull the module in regardless of the local binding, so they are matched on
 * the module specifier instead of on any identifier.
 */
const PROCESS_MODULE_IMPORT = /\bfrom\s*["']node:process["']|require\s*\(\s*["']node:process["']\s*\)/;

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
const CONSOLE_WRITE = /\bconsole\s*\.\s*(log|info|debug|table)\s*\(/;

/**
 * Only the reference transport and the process entry may see the library.
 * protocol/types.ts is type-only: `export type` re-exports of the protocol
 * types, erased at build, so importing it never loads the library.
 */
const MAY_IMPORT_LIBRARY = new Set(["protocol/reference.ts", "main.ts", "protocol/types.ts"]);

describe("@okfit/lsp boundaries", () => {
	const all = sources();

	it("no file under src/ reads `process` except bin.ts, main.ts and version.ts", () => {
		const offenders = all
			.filter(
				({ file, code }) =>
					!MAY_READ_PROCESS.has(file) && (/\bprocess\s*\./.test(code) || PROCESS_MODULE_IMPORT.test(code)),
			)
			.map(({ file }) => file);
		assert.deepStrictEqual(offenders, []);
	});

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

	it("PROCESS_MODULE_IMPORT catches every form that reaches node:process, not just a bare `process.` access", () => {
		assert.isTrue(PROCESS_MODULE_IMPORT.test(stripComments('import process from "node:process";')));
		assert.isTrue(PROCESS_MODULE_IMPORT.test(stripComments('import * as p from "node:process";')));
		// A named import never writes the identifier `process` at all, so only the module-specifier match catches it.
		assert.isTrue(PROCESS_MODULE_IMPORT.test(stripComments('import { env } from "node:process";')));
		assert.isTrue(PROCESS_MODULE_IMPORT.test(stripComments('const process = require("node:process");')));
		// Negative control: importing an unrelated module (or `process` from anywhere else) does not trip it.
		assert.isFalse(PROCESS_MODULE_IMPORT.test(stripComments('import { Effect } from "effect";')));
	});

	it("the process-import scanner is wired into the src/ sweep, and an allowed file is exempt from it (negative control)", () => {
		const detects = (file: string, code: string): boolean =>
			!MAY_READ_PROCESS.has(file) && (/\bprocess\s*\./.test(code) || PROCESS_MODULE_IMPORT.test(code));
		assert.isTrue(detects("features/hover.ts", 'import { env } from "node:process";'));
		// main.ts is one of the three files this rule allows to read process.
		assert.isFalse(detects("main.ts", 'import { env } from "node:process";'));
	});

	it("STDOUT_WRITE_CALL catches a process.stdout method call even where a bare reference is allowlisted (positive control)", () => {
		assert.isTrue(STDOUT_WRITE_CALL.test(stripComments('process.stdout.write("x");')));
		assert.isFalse(STDOUT_WRITE_CALL.test(stripComments("const streams = { output: process.stdout };")));
	});
});
