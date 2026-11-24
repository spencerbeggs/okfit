import { assert, describe, it } from "@effect/vitest";
import { Bundle, Graph, OkfitConfig } from "@okfit/core";
import { DateTime, Effect, Option } from "effect";
import { collect } from "../../src/render/sort.js";
import { run } from "../../src/validate/run.js";
import { ERROR_PROJECTS, V02_PROJECT } from "../fixtures/bundles.js";
import { ROOT, mountProject, sessionPlatform } from "../utils/bundle.js";

const FROM = "computations/revenue-ytd.md";
const LINK = "metrics/revenue.md";
const ATTESTER = "references/attesters/check.py";

/** What a resolution is, as a comparable pair; `false` when it is not a node. */
const landing = (resolution: ReturnType<typeof Graph.resolve>) =>
	resolution._tag === "node" && [resolution.kind, resolution.via];

describe("before phase 4 (characterization; later tasks flip the marked lines)", () => {
	it.effect("V02: two references resolve only through the root fallback", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const link = Graph.resolve(bundle, FROM, LINK);
			const attester = Graph.resolve(bundle, FROM, ATTESTER, "attester.resource");
			assert.deepStrictEqual(
				[landing(link), landing(attester)],
				[
					["concept", "root"],
					["file", "root"],
				],
			);
			// control: the rooted spelling lands through `rooted`, so `via` really tells the two apart
			assert.deepStrictEqual(landing(Graph.resolve(bundle, FROM, `/${LINK}`)), ["concept", "rooted"]);

			const result = yield* run({
				root: ROOT,
				projectRoot: "/repo",
				config: OkfitConfig.DEFAULTS,
				profile: Option.none(),
				now: DateTime.makeUnsafe("2026-11-24T00:00:00Z"),
				skipProvenance: true,
			});
			const sources = new Set(
				collect(result.report.conformance, result.report.lint, result.profileDiagnostics).map((d) => d.source),
			);
			// control: the report is not empty (README.md has no frontmatter), so the source check is not vacuous
			assert.isAbove(sources.size, 0);
			// Task 3: --target adds the "migrate" source
			assert.isFalse(
				[...sources].some((source) => source !== "core.conformance" && source !== "core.lint" && source !== "profile"),
			);
			assert.isFalse((sources as ReadonlySet<string>).has("migrate"));
		}).pipe(Effect.provide(sessionPlatform(mountProject(V02_PROJECT)))),
	);

	it.effect("bare-path-under-0.3: the same two references are dangling", () =>
		Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			// positive control for Task 3's legacy re-resolution: the 0.3 declaration is what makes them dangle
			assert.deepStrictEqual(landing(Graph.resolve(bundle, FROM, LINK)), ["missing", "file"]);
			assert.deepStrictEqual(landing(Graph.resolve(bundle, FROM, ATTESTER, "attester.resource")), ["missing", "file"]);
			const dangling = Graph.fromBundle(bundle)
				.dangling()
				.map((edge) => `${edge.from} -> ${edge.data.raw}`)
				.toSorted();
			assert.deepStrictEqual(
				dangling,
				[`computations/revenue-ytd -> ${LINK}`, `computations/revenue-ytd -> ${ATTESTER}`].toSorted(),
			);
		}).pipe(Effect.provide(sessionPlatform(mountProject(ERROR_PROJECTS["bare-path-under-0.3"])))),
	);
});
