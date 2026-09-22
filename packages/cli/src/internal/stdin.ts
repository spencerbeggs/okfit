import type { PlatformError } from "effect";
import { Effect, Runtime, Schema, Stdio, Stream } from "effect";

/**
 * `--document` reads the draft from stdin, and stdin is a terminal: reading would
 * block forever waiting for input nobody is piping. Exit 64: a usage error.
 *
 * @internal
 */
export class DocumentStdinIsTerminalError extends Schema.TaggedError<DocumentStdinIsTerminalError>()(
	"DocumentStdinIsTerminalError",
	{ path: Schema.String },
) {
	override readonly [Runtime.errorExitCode] = 64;
	override get message(): string {
		return `--document reads the document's text from stdin, but stdin is a terminal; pipe it in, for example: okfit validate --document ${this.path} < draft.md`;
	}
}

/**
 * The whole of stdin as UTF-8 text, for `okfit validate --document <path>` (spec 4.5).
 *
 * @internal
 */
export const readDocumentText = (
	path: string,
): Effect.Effect<string, DocumentStdinIsTerminalError | PlatformError.PlatformError, Stdio.Stdio> =>
	Effect.gen(function* () {
		const stdio = yield* Stdio.Stdio;
		if (yield* stdio.stdinIsTerminal) return yield* new DocumentStdinIsTerminalError({ path });
		return yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
	});
