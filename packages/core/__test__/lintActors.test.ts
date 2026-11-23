import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Bundle } from "../src/Bundle.js";
import type { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";
import { MOUNT, platform } from "./utils/fixtures.js";
import { platformFor } from "./utils/lintFixtures.js";

const ROOT = "/repo/okf";
const Platform = platformFor("lint-actors", ROOT);

const lintWith = (humans: ReadonlyArray<string> | undefined) =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: ROOT });
		const config = {
			extensions: {},
			...(humans === undefined ? {} : { actors: { humans } }),
		} as unknown as OkfitConfig;
		return { bundle, lint: Validate.lint(bundle, config) };
	}).pipe(Effect.provide(Platform));

const of = (lint: ReadonlyArray<{ readonly code: string; readonly file: string }>, code: string) =>
	lint.filter((d) => d.code === code).map((d) => d.file);

describe("actor-email", () => {
	it.effect("flags generated.by and verified[].by in concepts, anchored at the value", () =>
		Effect.gen(function* () {
			const { bundle, lint } = yield* lintWith(undefined);
			const found = lint.filter((d) => d.code === "actor-email");
			assert.deepStrictEqual(
				found.map((d) => d.file),
				["emailed.md", "emailed.md"],
			);
			const emailed = [...bundle.concepts.values()].find((c) => c.path === "emailed.md");
			const spans = found.map((d) =>
				d.range === undefined || emailed === undefined
					? undefined
					: emailed.document.source.slice(d.range.offset, d.range.offset + d.range.length),
			);
			assert.deepStrictEqual(spans, ["human:ada@example.com", "human:spencer@example.com"]);
			assert.isTrue(found.every((d) => d.severity === "warning"));
		}),
	);

	it.effect("flags an [actors].humans entry as a bundle-level finding", () =>
		Effect.gen(function* () {
			const { lint } = yield* lintWith(["human:spencer@example.com", "human:spencer"]);
			const config = lint.filter((d) => d.code === "actor-email" && d.file === "");
			assert.strictEqual(config.length, 1);
			assert.match(config[0]?.message ?? "", /human:spencer@example\.com/);
			assert.match(config[0]?.message ?? "", /actors\.humans/);
		}),
	);
});

describe("verified-actor-unknown", () => {
	it.effect("is silent when [actors].humans is empty or absent", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(of((yield* lintWith(undefined)).lint, "verified-actor-unknown"), []);
			assert.deepStrictEqual(of((yield* lintWith([])).lint, "verified-actor-unknown"), []);
		}),
	);

	it.effect("flags unlisted human verifiers and bindings, case-insensitively, ignoring machines", () =>
		Effect.gen(function* () {
			const { bundle, lint } = yield* lintWith(["human:spencer"]);
			const found = lint.filter((d) => d.code === "verified-actor-unknown");
			// listed.md: human:Spencer matches human:spencer; process:ci is a machine -- neither fires.
			// stranger.md: the entry and its binding both fire. emailed.md: human:spencer@example.com
			// does not match human:spencer. bare.md: the bare mapping fires once.
			assert.deepStrictEqual(found.map((d) => d.file).toSorted(), [
				"bare.md",
				"emailed.md",
				"stranger.md",
				"stranger.md",
			]);
			assert.isTrue(found.every((d) => d.range !== undefined));
			const bare = [...bundle.concepts.values()].find((c) => c.path === "bare.md");
			const bareFinding = found.find((d) => d.file === "bare.md");
			assert.strictEqual(
				bareFinding?.range === undefined || bare === undefined
					? undefined
					: bare.document.source.slice(bareFinding.range.offset, bareFinding.range.offset + bareFinding.range.length),
				"human:eve",
			);
			assert.match(found.find((d) => d.file === "stranger.md")?.message ?? "", /human:mallory.*actors\.humans/);
		}),
	);

	it.effect("a glob entry admits its matches", () =>
		Effect.gen(function* () {
			const { lint } = yield* lintWith(["human:spencer*", "human:mal*", "human:eve"]);
			assert.deepStrictEqual(of(lint, "verified-actor-unknown"), []);
		}),
	);
});

describe("actor-prefix-unknown after a dropped verified entry", () => {
	it.effect("ranges the finding at the surviving entry's own line", () =>
		Effect.gen(function* () {
			const text = "---\ntype: Note\nverified:\n  - by: human:a\n  - by: crew:x\n    at: 2026-06-25T09:00:00Z\n---\n";
			const bundle = yield* Bundle.load({ root: MOUNT });
			const found = Validate.lint(bundle, { extensions: {} } as unknown as OkfitConfig).filter(
				(d) => d.code === "actor-prefix-unknown",
			);
			assert.strictEqual(found.length, 1);
			const range = found[0]?.range;
			assert.isDefined(range);
			assert.strictEqual(text.slice(range!.offset, range!.offset + range!.length), "crew:x");
		}).pipe(
			Effect.provide(
				platform({
					[`${MOUNT}/n.md`]:
						"---\ntype: Note\nverified:\n  - by: human:a\n  - by: crew:x\n    at: 2026-06-25T09:00:00Z\n---\n",
				}),
			),
		),
	);
});

describe("actor-prefix-unknown", () => {
	const run = (text: string) =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: MOUNT });
			const found = Validate.lint(bundle, { extensions: {} } as unknown as OkfitConfig).filter(
				(d) => d.code === "actor-prefix-unknown",
			);
			return found.map((d) => ({
				message: d.message,
				text: d.range === undefined ? undefined : text.slice(d.range.offset, d.range.offset + d.range.length),
			}));
		}).pipe(Effect.provide(platform({ [`${MOUNT}/n.md`]: text })));

	it.effect("accepts team: and flags only the unknown scheme in sources[].author", () => {
		const text =
			"---\ntype: Note\ngenerated:\n  by: team:writers\n  at: 2026-06-25T09:00:00Z\nsources:\n  - resource: a.md\n    author: team:platform\n  - resource: b.md\n    author: crew:x\n---\n";
		return Effect.gen(function* () {
			const found = yield* run(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0]?.text, "crew:x");
			assert.include(found[0]?.message ?? "", "team:<id>");
		});
	});

	it.effect("ranges a source author at its own line after an ignored entry", () => {
		const text = "---\ntype: Note\nsources:\n  - title: no resource\n  - resource: b.md\n    author: crew:x\n---\n";
		return Effect.gen(function* () {
			const found = yield* run(text);
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0]?.text, "crew:x");
		});
	});
});
