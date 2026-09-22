import { assert, describe, it } from "@effect/vitest";
import { Effect, Stdio, Stream } from "effect";
import { DocumentStdinIsTerminalError, readDocumentText } from "../../src/internal/stdin.js";

const encoder = new TextEncoder();

describe("readDocumentText", () => {
	it.effect("decodes piped stdin to one string, across chunk boundaries", () =>
		Effect.gen(function* () {
			const text = yield* readDocumentText("a.md");
			assert.strictEqual(text, "---\ntype: Module\n---\n\ncafé\n");
		}).pipe(
			Effect.provide(
				Stdio.layerTest({
					stdinIsTerminal: Effect.succeed(false),
					stdin: Stream.make(encoder.encode("---\ntype: Module\n---\n\ncaf"), encoder.encode("é\n")),
				}),
			),
		),
	);

	it.effect("refuses a terminal stdin with a usage error instead of waiting forever", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(readDocumentText("a.md"));
			assert.instanceOf(error, DocumentStdinIsTerminalError);
			assert.include(error.message, "okfit validate --document a.md < ");
		}).pipe(Effect.provide(Stdio.layerTest({ stdinIsTerminal: Effect.succeed(true), stdin: Stream.never }))),
	);
});
