import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path } from "effect";

const FIXTURES = new URL("../fixtures/", import.meta.url).pathname;

/**
 * Copy one fixture project into a fresh temp directory for the calling
 * test, so a test that mutates a concept cannot leak into the next. The
 * directory is removed when the test's scope closes. `NodeServices.layer`
 * is provided internally so callers need not thread `FileSystem`/`Path`
 * through their own requirement channel.
 *
 * @public
 */
export const copyFixtureProject = (name: "project" | "broken-config" | "missing-bundle") =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = yield* fs.makeTempDirectoryScoped();
		const target = path.join(dir, name);
		yield* fs.copy(path.join(FIXTURES, name), target);
		return target;
	}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

/**
 * `copyFixtureProject("project")` with the deprecated `metrics/gross-margin-legacy` pointing at its replacement
 * through `superseded_by` (the fixture predates OKF 0.3 and carries none).
 */
export const copySupersededProject = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const root = yield* copyFixtureProject("project");
	const file = `${root}/bundle/metrics/gross-margin-legacy.md`;
	const text = yield* fs.readFileString(file);
	const edited = text.replace("status: deprecated\n", "status: deprecated\nsuperseded_by: /metrics/gross-margin.md\n");
	if (edited === text) return yield* Effect.die(new Error(`fixture drift: no "status: deprecated" line in ${file}`));
	yield* fs.writeFileString(file, edited);
	return root;
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

/**
 * `copyFixtureProject("project")` plus two Metrics whose `status` is outside the vocabulary (`archived`, and the
 * number `5`) and one whose `status` is `""` (stable by OKF 0.3 section 11.2 rule 1).
 */
export const copyUnknownStatusProject = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const root = yield* copyFixtureProject("project");
	const write = (name: string, status: string) =>
		fs.writeFileString(
			`${root}/bundle/metrics/${name}.md`,
			`---\ntype: Metric\ntitle: ${name}\ndescription: A metric.\nstatus: ${status}\n---\n\n# ${name}\n\nBody.\n`,
		);
	yield* write("archived", "archived");
	yield* write("numbered", "5");
	yield* write("blank", '""');
	return root;
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
