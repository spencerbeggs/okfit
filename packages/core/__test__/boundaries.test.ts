import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { SourceBoundary } from "@effected/workspaces/testing";

const SRC_ROOT = join(import.meta.dirname, "..", "src");
const PLATFORM_FREE = [SourceBoundary.platformFree(builtinModules)];

describe("src boundaries", () => {
	it("no file under src imports a Node built-in or @effect/platform*", () => {
		const files = readdirSync(SRC_ROOT, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
		// Non-vacuity: a wrong root would otherwise report a spotless boundary.
		assert.isAbove(files.length, 0);
		const offences = files.flatMap((file) =>
			SourceBoundary.check(file, readFileSync(join(SRC_ROOT, file), "utf8"), PLATFORM_FREE),
		);
		assert.deepStrictEqual(offences, []);
	});

	it("the rule flags both built-in spellings and the platform packages, and spares the rest", () => {
		for (const source of [
			'import { join } from "node:path";',
			'import { join } from "path";',
			'import * as NodeServices from "@effect/platform-node/NodeServices";',
		]) {
			assert.isAbove(SourceBoundary.check("a.ts", source, PLATFORM_FREE).length, 0, source);
		}
		assert.lengthOf(SourceBoundary.check("a.ts", 'import { Effect } from "effect";', PLATFORM_FREE), 0);
	});
});
