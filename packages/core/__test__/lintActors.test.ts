import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Bundle } from "../src/Bundle.js";
import type { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";
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
