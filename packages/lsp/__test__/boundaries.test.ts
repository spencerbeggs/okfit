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
 * `main.ts` passes `process.stdin`/`process.stdout` as `streams` to
 * `makeReferenceTransport` (the controller ruling in `protocol/reference.ts`'s
 * TSDoc): the transport, not this file, ever calls `.write` on them. The
 * "writes to stdout" rule below still catches an actual `process.stdout.write`
 * or `console.log` anywhere, including here -- it just needs to see past a
 * bare `process.stdout` reference passed as an object.
 */
const MAY_REFERENCE_STDOUT = new Set(["main.ts"]);

/**
 * Only the reference transport and the process entry may see the library.
 * protocol/types.ts is type-only: `export type` re-exports of the protocol
 * types, erased at build, so importing it never loads the library.
 */
const MAY_IMPORT_LIBRARY = new Set(["protocol/reference.ts", "main.ts", "protocol/types.ts"]);

describe("@okfit/lsp boundaries", () => {
	it("no file under src/ reads `process` except bin.ts, main.ts and version.ts", () => {
		const offenders = sources()
			.filter(({ file, code }) => !MAY_READ_PROCESS.has(file) && /\bprocess\s*\./.test(code))
			.map(({ file }) => file);
		assert.deepStrictEqual(offenders, []);
	});

	it("no file under src/ writes to stdout: no process.stdout, console.log/info/debug/table", () => {
		const offenders = sources()
			.filter(
				({ file, code }) =>
					(!MAY_REFERENCE_STDOUT.has(file) && /\bprocess\s*\.\s*stdout\b/.test(code)) ||
					/\bconsole\s*\.\s*(log|info|debug|table)\s*\(/.test(code),
			)
			.map(({ file }) => file);
		assert.deepStrictEqual(offenders, []);
	});

	it("only protocol/reference.ts, main.ts and the type-only protocol/types.ts import vscode-languageserver", () => {
		const offenders = sources()
			.filter(({ file, code }) => !MAY_IMPORT_LIBRARY.has(file) && /from\s*["']vscode-languageserver/.test(code))
			.map(({ file }) => file);
		assert.deepStrictEqual(offenders, []);
	});

	it("the scanner catches a stdout write (positive control)", () => {
		assert.isTrue(/\bconsole\s*\.\s*(log|info|debug|table)\s*\(/.test(stripComments("const x = 1; console.log(x);")));
		assert.isFalse(
			/\bconsole\s*\.\s*(log|info|debug|table)\s*\(/.test(stripComments("// console.log(x)\nconsole.error(1);")),
		);
	});
});
