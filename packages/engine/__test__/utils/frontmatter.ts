import { FrontmatterSource } from "@effected/markdown";
import { YamlDocument } from "@effected/yaml";
import { Concept } from "@okfit/core";
import { Effect, Schema } from "effect";

/**
 * Parses `source`'s frontmatter the way `Bundle.load` does (a duplicate key fails
 * the YAML parse) and decodes it as a `Concept`. Test-only.
 */
export const decodeFrontmatter = (source: string) =>
	Effect.gen(function* () {
		const block = FrontmatterSource.split(source).frontmatter;
		const doc = yield* YamlDocument.parse(block?.value ?? "");
		const raw = doc.contents?.toValue() as Record<string, unknown>;
		return yield* Schema.decodeUnknownEffect(Concept)({ ...raw, extensions: {}, raw });
	});

/** How many lines of `source` match `pattern`. Test-only. */
export const countLines = (source: string, pattern: RegExp): number =>
	source.split("\n").filter((line) => pattern.test(line)).length;
