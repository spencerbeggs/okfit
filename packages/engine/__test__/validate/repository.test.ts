import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { ConceptId } from "@okfit/core";
import { Bundle, OkfitConfig } from "@okfit/core";
import { Effect, FileSystem, Layer, Path } from "effect";
import { OverlayDocuments, layerOverlayFileSystem } from "../../src/overlay/layer.js";
import { locateResource, resourceCandidates, withinRoot } from "../../src/validate/repository.js";
import { lintResources } from "../../src/validate/resources.js";
import { ERROR_PROJECTS, V02_PROJECT, V03_PROJECT } from "../fixtures/bundles.js";
import { ROOT, denyAccess, mountProject, projectPlatform, recordCalls, seedPlatform } from "../utils/bundle.js";

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

describe("containment edges (fix round 1)", () => {
	/** Lints the widget's `resource` over a recording memfs; returns its codes and the recorded accesses. */
	const widgetCodes = (
		resource: string,
		extras: Record<string, ReturnType<typeof MemoryFileSystem.symlink> | string> = {},
		options: { readonly projectRoot?: string; readonly root?: string; readonly base?: string } = {},
	) => {
		const calls: Array<string> = [];
		const seed = { ...mountProject(withWidgetResource(resource), options.base), ...extras };
		return Effect.gen(function* () {
			const bundle = yield* Bundle.load({ root: options.root ?? ROOT });
			const diagnostics = yield* lintResources(bundle, OkfitConfig.DEFAULTS, options.projectRoot ?? "/repo");
			return { codes: diagnostics.filter((d) => d.file === "modules/widget.md").map((d) => d.code), calls };
		}).pipe(Effect.provide(seedPlatform(seed, recordCalls(calls))));
	};
	const through = (calls: ReadonlyArray<string>, prefix: string) =>
		calls.filter((call) => call.split(" ")[1]?.startsWith(prefix) && !call.startsWith("realPath "));

	it.effect("a symlinked parent that leads outside is outside, and nothing is statted through it", () =>
		Effect.gen(function* () {
			const extras = { "/repo/linkdir": MemoryFileSystem.symlink("/elsewhere"), "/elsewhere/x": "secret" };
			for (const value of ["../../linkdir/x", "../../linkdir/absent"]) {
				const result = yield* widgetCodes(value, extras);
				assert.deepStrictEqual(result.codes, ["resource-outside-project"], value);
				assert.deepStrictEqual(through(result.calls, "/repo/linkdir"), [], value);
			}
			// control: the recorder is live, and an absent in-project file does reach lstat
			const control = yield* widgetCodes("../../packages/absent.md", extras);
			assert.deepStrictEqual(control.codes, ["source-resource-missing"]);
			assert.include(control.calls, "lstat /repo/packages/absent.md");
		}),
	);

	it.effect("a dangling link inside the project stays source-resource-missing", () =>
		Effect.gen(function* () {
			const result = yield* widgetCodes("../../dangle", { "/repo/dangle": MemoryFileSystem.symlink("/repo/nope") });
			assert.deepStrictEqual(result.codes, ["source-resource-missing"]);
			// control: a link that does leave the project is not "missing"
			const out = yield* widgetCodes("../../out", {
				"/repo/out": MemoryFileSystem.symlink("/elsewhere"),
				"/elsewhere/a": "x",
			});
			assert.deepStrictEqual(out.codes, ["resource-outside-project"]);
		}),
	);

	it.effect("a dangling link whose target is outside the project stays source-resource-missing (#462)", () =>
		Effect.gen(function* () {
			const dangling = yield* widgetCodes("../../dangle", {
				"/repo/dangle": MemoryFileSystem.symlink("/elsewhere/nope"),
			});
			assert.deepStrictEqual(dangling.codes, ["source-resource-missing"]);
			// control: once the target exists, the same link leaves the project
			const resolved = yield* widgetCodes("../../dangle", {
				"/repo/dangle": MemoryFileSystem.symlink("/elsewhere/nope"),
				"/elsewhere/nope": "x",
			});
			assert.deepStrictEqual(resolved.codes, ["resource-outside-project"]);
		}),
	);

	it.effect("a project root reached through a symlink still classifies what is inside as inside", () =>
		Effect.gen(function* () {
			const seed = (resource: string) => ({
				...mountProject(withWidgetResource(resource), "/real"),
				"/repo": MemoryFileSystem.symlink("/real"),
			});
			const run = (resource: string) =>
				Effect.gen(function* () {
					const bundle = yield* Bundle.load({ root: ROOT });
					const diagnostics = yield* lintResources(bundle, OkfitConfig.DEFAULTS, "/repo");
					return diagnostics.filter((d) => d.file === "modules/widget.md").map((d) => d.code);
				}).pipe(Effect.provide(seedPlatform(seed(resource))));
			assert.deepStrictEqual(yield* run("../../packages/widget"), []);
			assert.deepStrictEqual(yield* run("../../../elsewhere"), ["resource-outside-project"]);
		}),
	);

	it.effect("projectRoot equal to the bundle root: a path that leaves the bundle is outside", () =>
		Effect.gen(function* () {
			const options = { projectRoot: ROOT };
			assert.deepStrictEqual((yield* widgetCodes("../metrics/revenue.md", {}, options)).codes, []);
			assert.deepStrictEqual((yield* widgetCodes("../../packages/widget", {}, options)).codes, [
				"resource-outside-project",
			]);
		}),
	);

	it.effect("a value resolving exactly to the project root is inside; its parent is outside", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* widgetCodes("../..")).codes, []);
			assert.deepStrictEqual((yield* widgetCodes("../../..")).codes, ["resource-outside-project"]);
		}),
	);

	it.effect("a sibling sharing the root's name prefix is outside and never touched", () =>
		Effect.gen(function* () {
			const result = yield* widgetCodes("../../../repo-other/a.md", { "/repo-other/a.md": "x" });
			assert.deepStrictEqual(result.codes, ["resource-outside-project"]);
			assert.deepStrictEqual(through(result.calls, "/repo-other"), []);
			// control: the recorder saw the in-project accesses of the same run
			assert.isTrue(result.calls.some((call) => call.includes(" /repo/")));
		}),
	);

	it.effect("a /../x value is judged where it lands: inside the project is missing, beyond it is outside", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* widgetCodes("/../x")).codes, ["source-resource-missing"]);
			assert.deepStrictEqual((yield* widgetCodes("/../../x")).codes, ["resource-outside-project"]);
		}),
	);

	it.effect("a file used as a directory and a symlink loop are missing, not a failed run", () =>
		Effect.gen(function* () {
			const loops = { "/repo/a": MemoryFileSystem.symlink("/repo/b"), "/repo/b": MemoryFileSystem.symlink("/repo/a") };
			assert.deepStrictEqual((yield* widgetCodes("../../packages/widget/README.md/y")).codes, [
				"source-resource-missing",
			]);
			assert.deepStrictEqual((yield* widgetCodes("../../a", loops)).codes, ["source-resource-missing"]);
			// control: a value that resolves reports nothing
			assert.deepStrictEqual((yield* widgetCodes("../../packages/widget/README.md", loops)).codes, []);
		}),
	);

	it.effect("a document that exists only in the editor overlay counts as present (engine-level)", () =>
		Effect.gen(function* () {
			const run = (open: boolean) => {
				const documents = OverlayDocuments.make();
				const layer = Layer.mergeAll(
					layerOverlayFileSystem.pipe(
						Layer.provide(
							Layer.mergeAll(
								MemoryFileSystem.layerWith(mountProject(withWidgetResource("../../packages/widget/new.md"))),
								Layer.succeed(OverlayDocuments, documents),
							),
						),
					),
					Path.layer,
				);
				return Effect.gen(function* () {
					if (open) yield* documents.open("/repo/packages/widget/new.md", "x");
					const bundle = yield* Bundle.load({ root: ROOT });
					const diagnostics = yield* lintResources(bundle, OkfitConfig.DEFAULTS, "/repo");
					return diagnostics.filter((d) => d.file === "modules/widget.md").map((d) => d.code);
				}).pipe(Effect.provide(layer));
			};
			assert.deepStrictEqual(yield* run(true), []);
			// control: the same value without the overlay document is missing
			assert.deepStrictEqual(yield* run(false), ["source-resource-missing"]);
		}),
	);
});
