import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Bundle } from "../src/Bundle.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";
import { MOUNT, platform } from "./utils/fixtures.js";

const note = (extra: string): string => `---\ntype: Note\n${extra}---\n`;

const lintSuperseded = (seed: Record<string, string>, config: OkfitConfig = OkfitConfig.DEFAULTS) =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: MOUNT });
		return Validate.lint(bundle, config)
			.filter((d) => d.code.startsWith("superseded-by") || d.code === "broken-links")
			.map((d) => [d.file, d.code, d.range?.line] as const);
	}).pipe(Effect.provide(platform(Object.fromEntries(Object.entries(seed).map(([k, v]) => [`${MOUNT}/${k}`, v])))));

describe("superseded_by lints (OKF 0.3 5.4)", () => {
	it.effect("superseded_by without deprecated, and a replacement that is not a concept", () =>
		Effect.gen(function* () {
			const found = yield* lintSuperseded({
				"new.md": note(""),
				"old.md": note("status: deprecated\nsuperseded_by: ./new.md\n"),
				"live.md": note("superseded_by: ./new.md\n"),
				"asset.md": note("status: deprecated\nsuperseded_by: ./logo.png\n"),
				"logo.png": "",
				"self.md": note("status: deprecated\nsuperseded_by: ./self.md\n"),
				"gone.md": note("status: deprecated\nsuperseded_by: ./nowhere.md\n"),
			});
			assert.deepStrictEqual(found, [
				// rule order (broken-links, orphan, unresolved), then file order within a rule
				["gone.md", "broken-links", 3],
				["live.md", "superseded-by-orphan", 2],
				["asset.md", "superseded-by-unresolved", 3],
				["self.md", "superseded-by-unresolved", 3],
			]);
			// control: a deprecated concept pointing at a concept is clean
			assert.isFalse(found.some(([file]) => file === "old.md"));
		}),
	);

	it.effect("a self-reference is unresolved however it is spelled", () =>
		Effect.gen(function* () {
			const found = yield* lintSuperseded({
				"dot.md": note("status: deprecated\nsuperseded_by: ./dot.md\n"),
				"rooted.md": note("status: deprecated\nsuperseded_by: /rooted.md\n"),
				"bare.md": note("status: deprecated\nsuperseded_by: bare.md\n"),
				"anchor.md": note("status: deprecated\nsuperseded_by: anchor.md#x\n"),
				"other.md": note("status: deprecated\nsuperseded_by: ./target.md\n"),
				"target.md": note(""),
			});
			assert.deepStrictEqual(
				found.map(([file, code]) => [file, code]),
				[
					["anchor.md", "superseded-by-unresolved"],
					["bare.md", "superseded-by-unresolved"],
					["dot.md", "superseded-by-unresolved"],
					["rooted.md", "superseded-by-unresolved"],
				],
			);
			// control: pointing at another concept is clean
			assert.isFalse(found.some(([file]) => file === "other.md"));
		}),
	);

	it.effect("a self-anchor is reported once, as superseded-by-unresolved (#463)", () =>
		Effect.gen(function* () {
			const found = yield* lintSuperseded({
				"anchor.md": note("status: deprecated\nsuperseded_by: anchor.md#x\n"),
			});
			assert.deepStrictEqual(
				found.filter(([file]) => file === "anchor.md").map(([, code]) => code),
				["superseded-by-unresolved"],
			);
		}),
	);

	it.effect("a missing target is broken-links alone, never also superseded-by-unresolved", () =>
		Effect.gen(function* () {
			const found = yield* lintSuperseded({ "gone.md": note("status: deprecated\nsuperseded_by: /nowhere.md\n") });
			assert.deepStrictEqual(
				found.map(([, code]) => code),
				["broken-links"],
			);
		}),
	);

	it.effect("an external value fires unresolved; a leading-/ concept path is clean", () =>
		Effect.gen(function* () {
			const found = yield* lintSuperseded({
				"new.md": note(""),
				"web.md": note("status: deprecated\nsuperseded_by: https://example.com/x\n"),
				"rooted.md": note("status: deprecated\nsuperseded_by: /new.md\n"),
			});
			assert.deepStrictEqual(found, [["web.md", "superseded-by-unresolved", 3]]);
		}),
	);

	it.effect("an out-of-vocabulary status is not deprecated, so it is an orphan", () =>
		Effect.gen(function* () {
			const found = yield* lintSuperseded({
				"new.md": note(""),
				"odd.md": note("status: bogus\nsuperseded_by: ./new.md\n"),
			});
			assert.deepStrictEqual(
				found.map(([file, code]) => [file, code]),
				[["odd.md", "superseded-by-orphan"]],
			);
		}),
	);

	it.effect("an empty superseded_by is absent: neither lint fires (control: a real orphan does)", () =>
		Effect.gen(function* () {
			const found = yield* lintSuperseded({
				"new.md": note(""),
				"empty-string.md": note("status: deprecated\nsuperseded_by: ''\n"),
				"empty-list.md": note("status: deprecated\nsuperseded_by: []\n"),
				"empty-live.md": note("superseded_by: ''\n"),
				"control.md": note("superseded_by: ./new.md\n"),
			});
			assert.deepStrictEqual(
				found.map(([file, code]) => [file, code]),
				[["control.md", "superseded-by-orphan"]],
			);
		}),
	);

	it.effect("a non-string superseded_by adds no diagnostic from either lint", () =>
		Effect.gen(function* () {
			// The loader reports each exactly once, as a value-malformed frontmatter diagnostic.
			const loaded = yield* Bundle.load({ root: MOUNT }).pipe(
				Effect.provide(
					platform({
						[`${MOUNT}/list.md`]: note("status: deprecated\nsuperseded_by:\n  - ./new.md\n"),
						[`${MOUNT}/map.md`]: note("status: deprecated\nsuperseded_by:\n  path: ./new.md\n"),
						[`${MOUNT}/new.md`]: note(""),
					}),
				),
			);
			assert.deepStrictEqual(loaded.diagnostics.map((d) => [d.file, d.code]).sort(), [
				["list.md", "value-malformed"],
				["map.md", "value-malformed"],
			]);
			const found = yield* lintSuperseded({
				"new.md": note(""),
				"list.md": note("status: deprecated\nsuperseded_by:\n  - ./new.md\n"),
				"map.md": note("status: deprecated\nsuperseded_by:\n  path: ./new.md\n"),
				"control.md": note("superseded_by: ./new.md\n"),
			});
			assert.deepStrictEqual(
				found.map(([file, code]) => [file, code]),
				[["control.md", "superseded-by-orphan"]],
			);
		}),
	);

	it.effect("superseded_by_orphan = off silences only that code", () =>
		Effect.gen(function* () {
			const config = OkfitConfig.merge(OkfitConfig.DEFAULTS, { lint: { superseded_by_orphan: "off" }, extensions: {} });
			const found = yield* lintSuperseded(
				{
					"new.md": note(""),
					"live.md": note("superseded_by: ./new.md\n"),
					"self.md": note("status: deprecated\nsuperseded_by: ./self.md\n"),
				},
				config,
			);
			assert.deepStrictEqual(
				found.map(([file, code]) => [file, code]),
				[["self.md", "superseded-by-unresolved"]],
			);
		}),
	);
});
