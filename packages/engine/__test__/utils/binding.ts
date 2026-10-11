import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Bundle } from "@okfit/core";
import { Derivation } from "@okfit/profiles";
import { Effect } from "effect";

/** The placeholder a fixture puts where a content digest belongs. */
export const DIGEST = "__DIGEST__";

/**
 * Replaces {@link DIGEST} in the named bundle files with each concept's real content
 * digest. The digest excludes `integrity`, so filling it in does not change it. Test-only.
 */
export const bindFixtures = (root: string, names: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root });
		for (const name of names) {
			const concept = [...bundle.concepts.values()].find((entry) => entry.path === name);
			if (concept === undefined) return yield* Effect.die(new Error(`no concept ${name}`));
			const digest = yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source);
			const text = yield* Effect.promise(() => readFile(join(root, name), "utf8"));
			yield* Effect.promise(() => writeFile(join(root, name), text.replaceAll(DIGEST, digest)));
		}
	});
