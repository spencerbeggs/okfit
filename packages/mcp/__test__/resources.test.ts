import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { copyFixtureProject } from "./utils/fixtureProject.js";
import { makeHarness } from "./utils/harness.js";

/**
 * The fixture bundle's concept ids, one static resource each (Ruling,
 * task C4). Kept as a literal list rather than re-deriving it from the
 * bundle: a change here should be a deliberate, visible edit to this test,
 * not a silent pass-through of whatever the loader currently produces.
 */
const FIXTURE_CONCEPT_IDS = [
	"computations/gross-margin-period",
	"computations/revenue-ytd",
	"metrics/churn",
	"metrics/gross-margin",
	"metrics/gross-margin-legacy",
	"metrics/revenue",
	"policies/margin-standard",
	"policies/revenue-recognition",
	"skills/run-on-bq",
	"tables/orders",
];

const open = (fixture: "project" | "missing-bundle" = "project") =>
	Effect.gen(function* () {
		const root = yield* copyFixtureProject(fixture);
		const harness = yield* makeHarness(root);
		yield* harness.initialize;
		return { root, harness };
	});

describe("resources", () => {
	it.effect("lists a static resource for every fixture concept, plus okf://index", () =>
		Effect.gen(function* () {
			const { harness } = yield* open();
			const resources = yield* harness.listResources;
			const uris = resources.map((resource) => resource.uri);
			assert.ok(uris.includes("okf://index"));
			for (const id of FIXTURE_CONCEPT_IDS) {
				assert.ok(uris.includes(`okf://concept/${id}`), `missing okf://concept/${id}`);
			}
			assert.strictEqual(uris.length, FIXTURE_CONCEPT_IDS.length + 1);
		}).pipe(Effect.scoped),
	);

	it.effect("reads okf://index as the fixture bundle's root index.md verbatim", () =>
		Effect.gen(function* () {
			const { root, harness } = yield* open();
			const expected = readFileSync(join(root, "bundle", "index.md"), "utf8");
			const result = yield* harness.readResource("okf://index");
			assert.strictEqual(result.contents[0]?.text, expected);
			assert.strictEqual(result.contents[0]?.mimeType, "text/markdown");
		}).pipe(Effect.scoped),
	);

	it.effect("reads a nested concept id as that file's full text, frontmatter included", () =>
		Effect.gen(function* () {
			const { root, harness } = yield* open();
			const expected = readFileSync(join(root, "bundle", "metrics", "revenue.md"), "utf8");
			const result = yield* harness.readResource("okf://concept/metrics/revenue");
			assert.strictEqual(result.contents[0]?.text, expected);
			assert.ok(expected.startsWith("---\n"));
			assert.strictEqual(result.contents[0]?.mimeType, "text/markdown");
		}).pipe(Effect.scoped),
	);

	it.effect("fails a read of an unregistered concept uri at the protocol level", () =>
		Effect.gen(function* () {
			const { harness } = yield* open();
			const message = yield* harness.sendRequest("resources/read", { uri: "okf://concept/metrics/nope" });
			assert.ok(message.error !== undefined);
			assert.strictEqual(message.result, undefined);
		}).pipe(Effect.scoped),
	);

	it.effect("fails a read of okf://index when the bundle has no root index.md", () =>
		Effect.gen(function* () {
			const { root, harness } = yield* open();
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				yield* fs.remove(path.join(root, "bundle", "index.md"));
			}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
			const message = yield* harness.sendRequest("resources/read", { uri: "okf://index" });
			assert.ok(message.error !== undefined);
			assert.include(JSON.stringify(message), "no readable index.md");
			assert.notInclude(JSON.stringify(message), root);
		}).pipe(Effect.scoped),
	);

	describe("a root index.md that is a symbolic link (OKF 0.3 section 3.2)", () => {
		const SECRET = "# SECRET OUTSIDE INDEX\n";
		/** Replace the fixture's root index.md with a link to `target(outsideDir)`; returns the read response. */
		const readLinked = (target: (outside: string) => string, writeTarget: boolean) =>
			Effect.gen(function* () {
				const { root, harness } = yield* open();
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const path = yield* Path.Path;
					const outside = yield* fs.makeTempDirectoryScoped();
					if (writeTarget) yield* fs.writeFileString(path.join(outside, "index.md"), SECRET);
					const index = path.join(root, "bundle", "index.md");
					yield* fs.remove(index);
					yield* fs.symlink(target(outside), index);
				}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
				return yield* harness.sendRequest("resources/read", { uri: "okf://index" });
			}).pipe(Effect.scoped);

		it.effect("refuses an index.md linked outside the bundle and never serves the outside text", () =>
			Effect.gen(function* () {
				const message = yield* readLinked((outside) => `${outside}/index.md`, true);
				assert.ok(message.error !== undefined);
				assert.notInclude(JSON.stringify(message), "SECRET OUTSIDE INDEX");
				assert.include(JSON.stringify(message), "links out of the bundle");
			}),
		);

		it.effect("refuses a dangling index.md link", () =>
			Effect.gen(function* () {
				const message = yield* readLinked((outside) => `${outside}/missing.md`, false);
				assert.ok(message.error !== undefined);
				assert.include(JSON.stringify(message), "links out of the bundle");
			}),
		);

		it.effect("still serves an index.md linked to another file inside the bundle (control)", () =>
			Effect.gen(function* () {
				const { root, harness } = yield* open();
				const expected = readFileSync(join(root, "bundle", "index.md"), "utf8");
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const path = yield* Path.Path;
					yield* fs.copyFile(path.join(root, "bundle", "index.md"), path.join(root, "bundle", "real-index.md"));
					yield* fs.remove(path.join(root, "bundle", "index.md"));
					yield* fs.symlink(path.join(root, "bundle", "real-index.md"), path.join(root, "bundle", "index.md"));
				}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
				const result = yield* harness.readResource("okf://index");
				assert.strictEqual(result.contents[0]?.text, expected);
			}).pipe(Effect.scoped),
		);
	});

	describe("a concept file that links out of the bundle after boot (OKF 0.3 section 3.2)", () => {
		/** Runs `swap(bundleRoot, outside)` on the real disk after the server booted, then reads `uri`. */
		const readAfter = (
			uri: string,
			swap: (fs: FileSystem.FileSystem, bundle: string, outside: string) => Effect.Effect<void, unknown>,
		) =>
			Effect.gen(function* () {
				const { root, harness } = yield* open();
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const outside = yield* fs.makeTempDirectoryScoped();
					yield* swap(fs, join(root, "bundle"), outside);
				}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
				const refused = yield* harness.sendRequest("resources/read", { uri });
				return { harness, refused, root };
			});

		const secretFile = (fs: FileSystem.FileSystem, outside: string, text: string) =>
			fs.writeFileString(`${outside}/revenue.md`, text);

		it.effect("refuses a concept replaced by a link out of the bundle, and serves an unchanged one (#460)", () =>
			Effect.gen(function* () {
				const { harness, refused, root } = yield* readAfter("okf://concept/metrics/revenue", (fs, bundle, outside) =>
					Effect.gen(function* () {
						yield* secretFile(fs, outside, "SECRET OUTSIDE CONCEPT");
						yield* fs.remove(`${bundle}/metrics/revenue.md`);
						yield* fs.symlink(`${outside}/revenue.md`, `${bundle}/metrics/revenue.md`);
					}),
				);
				assert.ok(refused.error !== undefined);
				assert.notInclude(JSON.stringify(refused), "SECRET OUTSIDE CONCEPT");
				assert.include(JSON.stringify(refused), "metrics/revenue.md links out of the bundle");
				const churn = yield* harness.readResource("okf://concept/metrics/churn");
				assert.strictEqual(churn.contents[0]?.text, readFileSync(join(root, "bundle", "metrics", "churn.md"), "utf8"));
			}).pipe(Effect.scoped),
		);

		it.effect("refuses a concept whose directory was replaced by a link out of the bundle (#460)", () =>
			Effect.gen(function* () {
				const { harness, refused, root } = yield* readAfter("okf://concept/metrics/revenue", (fs, bundle, outside) =>
					Effect.gen(function* () {
						yield* secretFile(fs, outside, "SECRET OUTSIDE DIR");
						yield* fs.rename(`${bundle}/metrics`, `${bundle}/metrics.moved`);
						yield* fs.symlink(outside, `${bundle}/metrics`);
					}),
				);
				assert.ok(refused.error !== undefined);
				assert.notInclude(JSON.stringify(refused), "SECRET OUTSIDE DIR");
				assert.include(JSON.stringify(refused), "metrics/revenue.md links out of the bundle");
				const orders = yield* harness.readResource("okf://concept/tables/orders");
				assert.strictEqual(orders.contents[0]?.text, readFileSync(join(root, "bundle", "tables", "orders.md"), "utf8"));
			}).pipe(Effect.scoped),
		);

		it.effect("refuses a concept replaced by a dangling link (#460)", () =>
			Effect.gen(function* () {
				const { refused } = yield* readAfter("okf://concept/metrics/revenue", (fs, bundle, outside) =>
					Effect.gen(function* () {
						yield* fs.remove(`${bundle}/metrics/revenue.md`);
						yield* fs.symlink(`${outside}/missing.md`, `${bundle}/metrics/revenue.md`);
					}),
				);
				assert.ok(refused.error !== undefined);
				assert.include(JSON.stringify(refused), "metrics/revenue.md links out of the bundle");
			}).pipe(Effect.scoped),
		);

		it.effect("refuses a concept whose directory was replaced by a dangling link (#460)", () =>
			Effect.gen(function* () {
				const { refused } = yield* readAfter("okf://concept/metrics/revenue", (fs, bundle, outside) =>
					Effect.gen(function* () {
						yield* fs.rename(`${bundle}/metrics`, `${bundle}/metrics.moved`);
						yield* fs.symlink(`${outside}/nowhere`, `${bundle}/metrics`);
					}),
				);
				assert.ok(refused.error !== undefined);
				assert.include(JSON.stringify(refused), "metrics/revenue.md links out of the bundle");
			}).pipe(Effect.scoped),
		);

		it.effect("refuses a concept whose grandparent directory was replaced by a link out (#460)", () =>
			Effect.gen(function* () {
				const root = yield* copyFixtureProject("project");
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					yield* fs.makeDirectory(`${root}/bundle/deep/mid`, { recursive: true });
					yield* fs.writeFileString(`${root}/bundle/deep/mid/c.md`, "---\ntype: Metric\ntitle: c\n---\n\n# c\n");
				}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
				const harness = yield* makeHarness(root);
				yield* harness.initialize;
				const listed = (yield* harness.listResources).map((resource) => resource.uri);
				assert.include(listed, "okf://concept/deep/mid/c");
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const outside = yield* fs.makeTempDirectoryScoped();
					yield* fs.makeDirectory(`${outside}/mid`);
					yield* fs.writeFileString(`${outside}/mid/c.md`, "SECRET GRANDPARENT");
					yield* fs.rename(`${root}/bundle/deep`, `${root}/bundle/deep.moved`);
					yield* fs.symlink(outside, `${root}/bundle/deep`);
				}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
				const refused = yield* harness.sendRequest("resources/read", { uri: "okf://concept/deep/mid/c" });
				assert.ok(refused.error !== undefined);
				assert.notInclude(JSON.stringify(refused), "SECRET GRANDPARENT");
				assert.include(JSON.stringify(refused), "deep/mid/c.md links out of the bundle");
			}).pipe(Effect.scoped),
		);

		it.effect("answers a concept deleted after boot with a bundle-relative message (#460)", () =>
			Effect.gen(function* () {
				const { refused, root } = yield* readAfter("okf://concept/metrics/revenue", (fs, bundle) =>
					fs.remove(`${bundle}/metrics/revenue.md`),
				);
				assert.ok(refused.error !== undefined);
				assert.include(JSON.stringify(refused), "no readable concept file at metrics/revenue.md");
				assert.notInclude(JSON.stringify(refused), root);
			}).pipe(Effect.scoped),
		);

		it.effect("still serves a concept replaced by a link to another file inside the bundle (control)", () =>
			Effect.gen(function* () {
				const { root, harness } = yield* open();
				const expected = readFileSync(join(root, "bundle", "metrics", "revenue.md"), "utf8");
				yield* Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					const bundle = join(root, "bundle");
					yield* fs.copyFile(`${bundle}/metrics/revenue.md`, `${bundle}/real-revenue.md`);
					yield* fs.remove(`${bundle}/metrics/revenue.md`);
					yield* fs.symlink(`${bundle}/real-revenue.md`, `${bundle}/metrics/revenue.md`);
				}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
				const result = yield* harness.readResource("okf://concept/metrics/revenue");
				assert.strictEqual(result.contents[0]?.text, expected);
			}).pipe(Effect.scoped),
		);
	});

	describe("a file replaced between its resolution and the identity compare (#460)", () => {
		/**
		 * Boots the server, then lets the `nth` `lstat` of the file ending in `suffix` re-save it first (same text, new
		 * inode). The concept read lstats once; the index read first loads the bundle, whose walk and loader lstat the file
		 * three times before the resource's own read (the fourth).
		 */
		const readWhileResaved = (uri: string, suffix: string, nth = 1) =>
			Effect.gen(function* () {
				const root = yield* copyFixtureProject("project");
				let armed = false;
				let fired = false;
				let calls = 0;
				const harness = yield* makeHarness(root, {
					wrapFileSystem: (fs) => ({
						...fs,
						lstat: (target) =>
							armed && !fired && target.endsWith(suffix) && ++calls >= nth
								? Effect.suspend(() => {
										fired = true;
										return fs.readFileString(target).pipe(
											Effect.flatMap((text) => Effect.andThen(fs.remove(target), fs.writeFileString(target, text))),
											Effect.orDie,
										);
									}).pipe(Effect.andThen(fs.lstat(target)))
								: fs.lstat(target),
					}),
				});
				yield* harness.initialize;
				armed = true;
				const message = yield* harness.sendRequest("resources/read", { uri });
				return { message, fired };
			}).pipe(Effect.scoped);

		it.effect("a concept answers 'changed while it was read; try again', never a link verdict", () =>
			Effect.gen(function* () {
				const { message, fired } = yield* readWhileResaved(
					"okf://concept/metrics/revenue",
					"/bundle/metrics/revenue.md",
				);
				assert.isTrue(fired, "the re-save must have run");
				assert.ok(message.error !== undefined);
				assert.include(JSON.stringify(message), "metrics/revenue.md changed while it was read; try again");
				assert.notInclude(JSON.stringify(message), "links out of the bundle");
			}),
		);

		it.effect("okf://index answers 'changed while it was read; try again', never a link verdict", () =>
			Effect.gen(function* () {
				const { message, fired } = yield* readWhileResaved("okf://index", "/bundle/index.md", 4);
				assert.isTrue(fired, "the re-save must have run");
				assert.ok(message.error !== undefined);
				assert.include(JSON.stringify(message), "index.md changed while it was read; try again");
				assert.notInclude(JSON.stringify(message), "links out of the bundle");
			}),
		);
	});

	it.effect("boots with only okf://index listed when the bundle fails to load", () =>
		Effect.gen(function* () {
			const { harness } = yield* open("missing-bundle");
			const resources = yield* harness.listResources;
			assert.deepStrictEqual(
				resources.map((resource) => resource.uri),
				["okf://index"],
			);
		}).pipe(Effect.scoped),
	);
});
