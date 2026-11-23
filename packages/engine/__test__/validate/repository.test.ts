import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { ConceptId } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Effect, FileSystem, Path } from "effect";
import { locateResource, resourceCandidates, withinRoot } from "../../src/validate/repository.js";
import { lintResources } from "../../src/validate/resources.js";
import { ERROR_PROJECTS, V02_PROJECT, V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, denyAccess, mountProject, projectPlatform, seedPlatform } from "../utils/bundle.js";

const WIDGET = "modules/widget" as ConceptId;
const widgetPath = "okf/modules/widget.md";
/** `V03_PROJECT` whose widget names `resource` and a second concept naming the in-project package. */
const withWidgetResource = (resource: string) => ({
	...V03_PROJECT,
	[widgetPath]: V03_PROJECT[widgetPath]?.replace("../../packages/widget", resource) as string,
	"okf/modules/gadget.md": (V03_PROJECT[widgetPath] as string).replace("Widget", "Gadget"),
});

describe("withinRoot", () => {
	it.effect("is lexical: the root, its descendants, but not a sibling prefix or a parent", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			assert.isTrue(withinRoot("/repo", "/repo", path));
			assert.isTrue(withinRoot("/repo", "/repo/a/b", path));
			assert.isFalse(withinRoot("/repo", "/repo-other/a", path));
			assert.isFalse(withinRoot("/repo", "/", path));
			assert.isFalse(withinRoot("/repo", "/elsewhere", path));
			assert.isTrue(withinRoot("/repo", "/repo/..foo", path));
		}).pipe(Effect.provide(Path.layer)),
	);
});

describe("repository resources (R1, R13)", () => {
	it.effect("classifies each candidate, and reports a value outside the project without touching it", () => {
		const touched: Array<string> = [];
		const platform = seedPlatform(
			{ ...mountProject(ERROR_PROJECTS["resource-outside-project"]), "/elsewhere/secret.md": "secret" },
			denyAccess(touched, [], "/elsewhere"),
		);
		return Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const bundle = yield* Bundle.load({ root: ROOT });
			const widget = bundle.concepts.get(WIDGET)!;
			const of = (value: string) => resourceCandidates({ bundle, concept: widget, value, projectRoot: "/repo", path });
			assert.deepStrictEqual(of("../../packages/widget"), [{ absolute: "/repo/packages/widget", scope: "repository" }]);
			assert.deepStrictEqual(of("/metrics/revenue.md"), [
				{ absolute: "/repo/okf/metrics/revenue.md", scope: "bundle" },
			]);
			assert.deepStrictEqual(of("../../../elsewhere"), []);
			// 0.3: no root fallback for a bare value
			assert.deepStrictEqual(of("metrics/revenue.md"), [
				{ absolute: "/repo/okf/modules/metrics/revenue.md", scope: "bundle" },
			]);
			const diagnostics = yield* lintResources(bundle, OkfitConfig.DEFAULTS, "/repo");
			assert.deepStrictEqual(
				diagnostics.map((d) => [d.file, d.code, d.severity, d.range?.line]),
				[["modules/widget.md", "resource-outside-project", "info", 6]],
			);
			assert.strictEqual(
				diagnostics[0]?.message,
				'Resource "../../../elsewhere" resolves outside the project root; okfit does not read it',
			);
			const off = {
				...OkfitConfig.DEFAULTS,
				lint: { ...OkfitConfig.DEFAULTS.lint, resource_outside_project: "off" as const },
			};
			assert.deepStrictEqual(yield* lintResources(bundle, off, "/repo"), []);
			// the guard is armed: nothing touched /elsewhere above, and a direct access is recorded and refused
			assert.deepStrictEqual(touched, []);
			yield* Effect.flip(fs.exists("/elsewhere/secret.md"));
			assert.deepStrictEqual(touched, ["exists /elsewhere/secret.md"]);
		}).pipe(Effect.provide(platform));
	});

	it.effect("checks an in-project repository resource (control)", () =>
		Effect.gen(function* () {
			const missing = yield* lintResources(yield* Bundle.load({ root: ROOT }), OkfitConfig.DEFAULTS, "/repo");
			assert.deepStrictEqual(
				missing.map((d) => [d.file, d.code]),
				[["modules/widget.md", "source-resource-missing"]],
			);
		}).pipe(Effect.provide(projectPlatform(ERROR_PROJECTS["resource-missing-in-repository"]))),
	);

	it.effect("V03_PROJECT yields no resource diagnostic at all", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(
				yield* lintResources(yield* Bundle.load({ root: ROOT }), OkfitConfig.DEFAULTS, "/repo"),
				[],
			);
		}).pipe(Effect.provide(projectPlatform(V03_PROJECT))),
	);

	it.effect("a bare value gains the bundle-root candidate only under a 0.2 bundle (the gate's control)", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const bundle = yield* Bundle.load({ root: ROOT });
			const widget = bundle.concepts.get(WIDGET)!;
			assert.deepStrictEqual(
				resourceCandidates({ bundle, concept: widget, value: "metrics/revenue.md", projectRoot: "/repo", path }),
				[
					{ absolute: "/repo/okf/modules/metrics/revenue.md", scope: "bundle" },
					{ absolute: "/repo/okf/metrics/revenue.md", scope: "bundle" },
				],
			);
		}).pipe(Effect.provide(projectPlatform(V02_PROJECT))),
	);

	it.effect("a symlink inside the project that points out of it is outside, and never followed", () => {
		const touched: Array<string> = [];
		const seed = {
			...mountProject(withWidgetResource("../../packages/link")),
			"/repo/packages/link": MemoryFileSystem.symlink("/elsewhere/real"),
			"/elsewhere/real/x.md": "secret",
		};
		return Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: ROOT });
			const diagnostics = yield* lintResources(bundle, OkfitConfig.DEFAULTS, "/repo");
			// the link is reported once; the in-project gadget resolves to the same package and is fine
			assert.deepStrictEqual(
				diagnostics.map((d) => [d.file, d.code]),
				[["modules/widget.md", "resource-outside-project"]],
			);
			assert.deepStrictEqual(touched, []);
			const located = yield* locateResource({
				bundle,
				concept: bundle.concepts.get("modules/gadget" as ConceptId)!,
				value: "../../packages/link",
				projectRoot: "/repo",
			});
			assert.strictEqual(located._tag, "outside");
			const inProject = yield* locateResource({
				bundle,
				concept: bundle.concepts.get("modules/gadget" as ConceptId)!,
				value: "../../packages/widget",
				projectRoot: "/repo",
			});
			assert.strictEqual(inProject._tag, "found");
		}).pipe(Effect.provide(seedPlatform(seed, denyAccess(touched, [], "/elsewhere"))));
	});
});
