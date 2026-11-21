import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import { JsoncFingerprint } from "@effected/jsonc";
import { Effect } from "effect";
import { Derivation } from "../src/Derivation.js";

const okfRoot = join(import.meta.dirname, "..", "..", "..", "okf");
const markdownUnder = (dir: string): Array<string> =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? markdownUnder(join(dir, entry.name))
			: entry.name.endsWith(".md")
				? [join(dir, entry.name)]
				: [],
	);

const corpus: ReadonlyArray<readonly [string, string]> = [
	["empty", ""],
	["ascii", "hello world"],
	["crlf", "a\r\nb\r\n"],
	["bare cr", "a\rb\r"],
	["bom", "﻿a\r\nb"],
	["non-bmp", "x \u{1F600} \u{1F9D1}‍\u{1F4BB} y"],
	["lone high surrogate", "a\uD800b"],
	["lone low surrogate", "a\uDC00b"],
	...markdownUnder(okfRoot).map((file): readonly [string, string] => [file, readFileSync(file, "utf8")]),
];

describe("Derivation.digestFull", () => {
	it.effect("is byte-identical to JsoncFingerprint.hashText over the corpus and the okf bundle", () =>
		Effect.gen(function* () {
			assert.isAbove(corpus.length, 8);
			for (const [label, text] of corpus) {
				const ours = yield* Derivation.digestFull(text);
				const theirs = yield* JsoncFingerprint.hashText(text);
				assert.strictEqual(ours, theirs, label);
			}
		}).pipe(Effect.provide(NodeCrypto.layerDigest)),
	);

	it.effect("pins golden sha256 values", () =>
		Effect.gen(function* () {
			assert.strictEqual(
				yield* Derivation.digestFull(""),
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			);
			assert.strictEqual(
				yield* Derivation.digestFull("abc"),
				"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
			);
		}).pipe(Effect.provide(NodeCrypto.layerDigest)),
	);
});
