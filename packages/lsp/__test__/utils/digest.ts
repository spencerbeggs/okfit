import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Bundle } from "@okfit/core";
import { Derivation } from "@okfit/profiles";
import type { Scope } from "effect";
import { Effect } from "effect";
import { acquireTempDir } from "./tempDir.js";

/**
 * The content digest of a concept file's `text`, computed the way a real run
 * does: written to a temp bundle, loaded through `Bundle.load`, hashed with
 * `Derivation.contentDigest`. An oracle independent of the LSP's own
 * buffer-text path. Test-only.
 */
export const loadedContentDigest = (text: string): Effect.Effect<string, never, Scope.Scope> =>
	Effect.gen(function* () {
		const root = yield* acquireTempDir("okfit-lsp-digest-");
		yield* Effect.promise(() => writeFile(join(root, "a.md"), text, "utf8"));
		const bundle = yield* Bundle.load({ root });
		const concept = [...bundle.concepts.values()][0];
		if (concept === undefined) return yield* Effect.die(new Error("digest oracle: no concept loaded"));
		return yield* Derivation.contentDigest(concept.frontmatter.raw, concept.document.source);
	}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

/**
 * `text` with an `integrity.verified` binding of `by` at `at` appended before
 * the closing fence, bound to the digest of `text` itself. Test-only.
 */
export const withBinding = (text: string, by: string, at: string): Effect.Effect<string, never, Scope.Scope> =>
	Effect.map(loadedContentDigest(text), (content) => {
		const close = text.indexOf("\n---\n", 4) + 1;
		return `${text.slice(0, close)}integrity:\n  verified:\n    by: "${by}"\n    at: "${at}"\n    content: ${content}\n${text.slice(close)}`;
	});
