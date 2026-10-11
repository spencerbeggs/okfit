import { Bundle } from "@okfit/core";
import { Derivation } from "@okfit/profiles";
import { Effect } from "effect";

/**
 * The content digest of the concept `id` in the bundle at `bundleRoot`, computed in the
 * test process (not by the bin under test): `Bundle.load` then `Derivation.contentDigest`.
 * Test-only.
 */
export const conceptDigest = (bundleRoot: string, id: string) =>
	Effect.gen(function* () {
		const bundle = yield* Bundle.load({ root: bundleRoot });
		const concept = [...bundle.concepts.entries()].find(([key]) => key === id)?.[1];
		if (concept === undefined) return yield* Effect.die(new Error(`no concept ${id}`));
		return yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source);
	});
