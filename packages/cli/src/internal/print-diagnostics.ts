import { Doc } from "@effected/cli";
import type { RenderedDiagnostic } from "@okfit/engine";
import type { Path } from "effect";
import { Config, Console, Effect, Option } from "effect";
import type { Counts } from "../render/human.js";
import { annotationDir, displayRoot, humanDoc, summary } from "../render/human.js";

/**
 * The human half of `validate` and `lint`: the diagnostics `Doc` on stdout,
 * then the `Counts` summary on stderr. GitHub resolves an annotation `file`
 * against `GITHUB_WORKSPACE` (an empty value counts as unset); it is read
 * through `Config`, never `process.env`.
 *
 * @internal
 */
export const printDiagnostics = Effect.fn("okfit/cli/printDiagnostics")(function* (options: {
	readonly diagnostics: ReadonlyArray<RenderedDiagnostic>;
	readonly cwd: string;
	readonly bundleRoot: string;
	readonly path: Path.Path;
	readonly concepts: number;
}) {
	const { diagnostics, cwd, bundleRoot, path } = options;
	const workspace = (yield* Config.String("GITHUB_WORKSPACE").pipe(Config.option)).pipe(
		Option.filter((value) => value !== ""),
	);
	yield* Doc.print(
		humanDoc(diagnostics, {
			root: bundleRoot,
			annotationDir: annotationDir(cwd, bundleRoot, Option.getOrUndefined(workspace), path),
		}),
	);
	const counts: Counts = {
		errors: diagnostics.filter((d) => d.severity === "error").length,
		warnings: diagnostics.filter((d) => d.severity === "warning").length,
		info: diagnostics.filter((d) => d.severity === "info").length,
		concepts: options.concepts,
	};
	yield* Console.error(summary(counts, displayRoot(cwd, bundleRoot, path)));
});
