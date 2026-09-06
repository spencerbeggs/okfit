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
