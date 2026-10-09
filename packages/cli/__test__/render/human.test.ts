import { assert, describe, it } from "@effect/vitest";
import { CliTheme, Render } from "@effected/cli";
import { DiagnosticRange } from "@okfit/core";
import type { RenderedDiagnostic } from "@okfit/engine";
import { Effect, Path } from "effect";
import { annotationDir, displayRoot, human, humanDoc, line, summary } from "../../src/render/human.js";

const ESC = String.fromCharCode(27);

// effect's own POSIX Path layer needs no FileSystem and no Node import (EF/Path.ts:867);
// same precedent as @okfit/engine's __test__/config/anchor.test.ts.
const path: Path.Path = Effect.runSync(Effect.provide(Path.Path, Path.layer));

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
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			const painted = theme.paint("error", "error");
			assert.isTrue(painted.includes(ESC));
			assert.strictEqual(
				line(base, { paint: theme.paint }),
				`modules/router.md ${painted} required-key-missing missing required key "description"`,
			);
		}).pipe(Effect.provide(CliTheme.layerTest({ color: "basic" }))),
	);

	it.effect("no paint (the default), or a colourless theme, never emits an escape byte", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			assert.isFalse(line(base, { paint: theme.paint }).includes(ESC));
			assert.isFalse(line(base).includes(ESC));
		}).pipe(Effect.provide(CliTheme.layerTest({ color: "none" }))),
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

describe("displayRoot", () => {
	it.effect("target under cwd renders relative (K-51)", () =>
		Effect.sync(() => {
			assert.strictEqual(displayRoot("/repo", "/repo/okf", path), "okf");
		}),
	);

	it.effect(
		"target equal to cwd renders the literal . (the dropped case that caused the init/validate divergence)",
		() =>
			Effect.sync(() => {
				assert.strictEqual(displayRoot("/repo", "/repo", path), ".");
			}),
	);

	it.effect("target outside cwd renders absolute, never a leading ..", () =>
		Effect.sync(() => {
			assert.strictEqual(displayRoot("/repo/sub", "/repo/other", path), "/repo/other");
		}),
	);

	it.effect("an absolute target on a different root renders absolute unchanged", () =>
		Effect.sync(() => {
			assert.strictEqual(displayRoot("/repo", "/elsewhere/okf", path), "/elsewhere/okf");
		}),
	);
});

const ranged: RenderedDiagnostic = {
	...base,
	file: "modules/web.md",
	code: "broken-links",
	severity: "warning",
	message: "link target missing",
	range: DiagnosticRange.make({ offset: 0, length: 1, line: 2, character: 4 }),
};
const bundleLevel: RenderedDiagnostic = { ...base, file: "", severity: "info", code: "config-unknown-key" };
const fixture: ReadonlyArray<RenderedDiagnostic> = [ranged, base, bundleLevel];

describe("humanDoc", () => {
	it.effect("plain render is byte-identical to the human lines", () =>
		Effect.sync(() => {
			const out = Render.plain(humanDoc(fixture), Render.contextOf({ audience: "agent" }));
			assert.strictEqual(out, human(fixture).join("\n"));
		}),
	);

	it.effect("githubLog adds one annotation per diagnostic, info as notice", () =>
		Effect.sync(() => {
			const out = Render.githubLog(humanDoc(fixture), Render.contextOf({ audience: "ci" }));
			assert.include(out, "::warning file=modules/web.md,line=3,col=5::broken-links link target missing");
			assert.include(out, "::error file=modules/router.md::required-key-missing");
			assert.include(out, "::notice::config-unknown-key");
		}),
	);

	it.effect("a workflow command in a message is neutralized onto one line", () =>
		Effect.sync(() => {
			const evil: RenderedDiagnostic = { ...base, message: "x\n::set-output name=a::b" };
			const out = Render.githubLog(humanDoc([evil]), Render.contextOf({ audience: "ci" }));
			assert.notInclude(out.split("\n").join("|"), "|::set-output");
			for (const l of out.split("\n")) assert.isFalse(l.startsWith("::set-output"));
		}),
	);

	it.effect("ansi colours only the severity word, exactly as the theme paints it today", () =>
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			const out = Render.ansi(humanDoc([base]), Render.contextOf({ audience: "human", color: "basic" }));
			assert.strictEqual(out, line(base, { paint: theme.paint }));
			assert.isTrue(out.includes(ESC));
		}).pipe(Effect.provide(CliTheme.layerTest({ color: "basic" }))),
	);
});

describe("annotationDir", () => {
	it.effect("GITHUB_WORKSPACE set: the bundle root relative to it, even when cwd is a subdirectory", () =>
		Effect.sync(() => {
			assert.strictEqual(annotationDir("/ws/pkg", "/ws/okf", "/ws", path), "okf");
			assert.strictEqual(annotationDir("/ws/pkg", "/ws", "/ws", path), ".");
		}),
	);

	it.effect("GITHUB_WORKSPACE set: a bundle outside it has no annotation dir", () =>
		Effect.sync(() => {
			assert.strictEqual(annotationDir("/ws", "/elsewhere/okf", "/ws", path), null);
			assert.strictEqual(annotationDir("/ws", "/ws-other/okf", "/ws", path), null);
		}),
	);

	it.effect("unset: relative to cwd when under it", () =>
		Effect.sync(() => {
			assert.strictEqual(annotationDir("/repo", "/repo/okf", undefined, path), "okf");
			assert.strictEqual(annotationDir("/repo", "/repo", undefined, path), ".");
		}),
	);

	it.effect("unset: absolute (outside cwd) has no annotation dir", () =>
		Effect.sync(() => {
			assert.strictEqual(annotationDir("/repo/sub", "/repo/other", undefined, path), null);
		}),
	);
});

describe("humanDoc annotationDir null", () => {
	it.effect("omits the annotation file but keeps line and col", () =>
		Effect.sync(() => {
			const out = Render.githubLog(humanDoc([ranged], { annotationDir: null }), Render.contextOf({ audience: "ci" }));
			assert.include(out, "::warning line=3,col=5::broken-links link target missing");
			assert.notInclude(out, "file=");
		}),
	);
});

describe("humanDoc at a finite width", () => {
	it("keeps each diagnostic on one physical line", () => {
		const long: RenderedDiagnostic = { ...base, message: "a very long message ".repeat(8).trim() };
		const out = Render.ansi(humanDoc([long]), Render.contextOf({ audience: "human", width: 40 }));
		assert.strictEqual(out.split("\n").length, 1);
	});
});
