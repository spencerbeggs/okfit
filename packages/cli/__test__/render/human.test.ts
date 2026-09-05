import { assert, describe, it } from "@effect/vitest";
import { DiagnosticRange } from "@okfit/core";
import { Effect } from "effect";
import { human, line, summary } from "../../src/render/human.js";
import type { RenderedDiagnostic } from "../../src/render/sort.js";

const ESC = String.fromCharCode(27);

const base: RenderedDiagnostic = {
	source: "core.lint",
	file: "modules/router.md",
	code: "required-key-missing",
	severity: "error",
	message: 'missing required key "description"',
};

describe("line", () => {
	it.effect("ranged: <file>:<line+1>:<char+1> <severity> <code> <message>, one-based", () =>
		Effect.sync(() => {
			const withRange: RenderedDiagnostic = {
				...base,
				range: DiagnosticRange.make({ offset: 0, length: 1, line: 11, character: 0 }),
			};
			assert.strictEqual(
				line(withRange),
				'modules/router.md:12:1 error required-key-missing missing required key "description"',
			);
		}),
	);

	it.effect("range-less: <file> <severity> <code> <message>", () =>
		Effect.sync(() => {
			assert.strictEqual(line(base), 'modules/router.md error required-key-missing missing required key "description"');
		}),
	);

	it.effect('bundle-level (file: "") renders as the literal (bundle)', () =>
		Effect.sync(() => {
			const bundleLevel: RenderedDiagnostic = {
				...base,
				file: "",
				severity: "warning",
				code: "config-unknown-key",
				message: 'unknown top-level key "extra_section"',
			};
			assert.strictEqual(
				line(bundleLevel),
				'(bundle) warning config-unknown-key unknown top-level key "extra_section"',
			);
		}),
	);

	it.effect("colour wraps only the severity word, never the code, path or message", () =>
		Effect.sync(() => {
			const colored = line(base, { color: true });
			assert.strictEqual(
				colored,
				`modules/router.md ${ESC}[31merror${ESC}[0m required-key-missing missing required key "description"`,
			);
		}),
	);

	it.effect("colour false (the default) never emits an escape byte", () =>
		Effect.sync(() => {
			assert.isFalse(line(base, { color: false }).includes(ESC));
			assert.isFalse(line(base).includes(ESC));
		}),
	);
});

describe("human", () => {
	it.effect("sorts before rendering: a range-less bundle-level entry leads a ranged file entry", () =>
		Effect.sync(() => {
			const ranged: RenderedDiagnostic = {
				...base,
				range: DiagnosticRange.make({ offset: 0, length: 1, line: 11, character: 0 }),
			};
			const bundleLevel: RenderedDiagnostic = { ...base, file: "", code: "config-unknown-key", severity: "warning" };
			assert.deepStrictEqual(human([ranged, bundleLevel]), [
				'(bundle) warning config-unknown-key missing required key "description"',
				'modules/router.md:12:1 error required-key-missing missing required key "description"',
			]);
		}),
	);
});

describe("summary", () => {
	it.effect("is the exact unpluralised K-20 text", () =>
		Effect.sync(() => {
			assert.strictEqual(
				summary({ errors: 1, warnings: 1, info: 0, concepts: 4 }, "okf"),
				"1 errors, 1 warnings, 0 info in 4 concepts (okf)",
			);
		}),
	);

	it.effect("renders zero counts identically (a clean run still prints a summary)", () =>
		Effect.sync(() => {
			assert.strictEqual(
				summary({ errors: 0, warnings: 0, info: 0, concepts: 1 }, "okf"),
				"0 errors, 0 warnings, 0 info in 1 concepts (okf)",
			);
		}),
	);
});
