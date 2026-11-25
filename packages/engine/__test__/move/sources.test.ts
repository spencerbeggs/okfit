import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Bundle } from "@okfit/core";
import { Effect } from "effect";
import { readMarkdownSources } from "../../src/move/sources.js";
import type { ProjectSeed } from "../fixtures/bundles.js";
import { V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, mountProject, projectPlatform, seedPlatform } from "../utils/bundle.js";

const SEED: ProjectSeed = {
	...V03_PROJECT,
	"okf/README.md": "# Notes\n\nSee [margin](metrics/margin.md).\n",
	"okf/notes.md": "---\ntitle: only a title\n---\n\nSee [x](metrics/margin.md).\n",
	"okf/metrics/log.md": "# Log\n\n## 2026-01-01\n\n* Added [margin](margin.md).\n",
};

const sourcesIn = (seed: ProjectSeed, reserved: boolean) =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: ROOT });
		return yield* readMarkdownSources(bundle, { reserved });
	}).pipe(Effect.provide(projectPlatform(seed)));

describe("readMarkdownSources", () => {
	it.effect("reserved: false returns what okfit mv scanned before", () =>
		Effect.gen(function* () {
			const result = yield* sourcesIn(SEED, false);
			assert.deepStrictEqual(result.sources.map((s) => s.path).sort(), ["README.md", "notes.md"]);
			assert.deepStrictEqual(result.unreadable, []);
			for (const source of result.sources) assert.isUndefined(source.frontmatter.type);
		}),
	);

	it.effect("reserved: true adds index.md and log.md with raw {}", () =>
		Effect.gen(function* () {
			const result = yield* sourcesIn(SEED, true);
			const paths = result.sources.map((s) => s.path);
			for (const reserved of ["index.md", "metrics/index.md", "metrics/log.md"]) assert.include(paths, reserved);
			for (const source of result.sources.filter((s) => s.path.endsWith("index.md") || s.path.endsWith("log.md"))) {
				assert.deepStrictEqual(source.frontmatter.raw, {});
				assert.isUndefined(source.frontmatter.type);
			}
			assert.include(paths, "README.md");
			assert.deepStrictEqual(result.unreadable, []);
		}),
	);

	it.effect("an unclosed frontmatter block is unreadable, never a source", () =>
		Effect.gen(function* () {
			const result = yield* sourcesIn({ ...SEED, "okf/bad.md": "---\ntitle: never closed\n\nbody\n" }, true);
			assert.deepStrictEqual(result.unreadable, ["bad.md"]);
			assert.notInclude(
				result.sources.map((s) => s.path),
				"bad.md",
			);
		}),
	);

	it.effect("a symlink-escape file is neither a source nor unreadable", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			assert.isTrue(bundle.diagnostics.some((d) => d.file === "escape.md" && d.code === "symlink-escape"));
			const result = yield* readMarkdownSources(bundle, { reserved: true });
			assert.notInclude(
				result.sources.map((s) => s.path),
				"escape.md",
			);
			assert.deepStrictEqual(result.unreadable, []);
		}).pipe(
			Effect.provide(
				seedPlatform({
					...mountProject(SEED),
					"/elsewhere/real.md": "# Outside\n",
					"/repo/okf/escape.md": MemoryFileSystem.symlink("/elsewhere/real.md"),
				}),
			),
		),
	);
});
