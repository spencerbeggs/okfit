import { Doc } from "@effected/cli-kit";
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
	/** The `--target` version: migrate findings then get their own summary line and stay out of the counts. */
	readonly target?: string;
	/** The `file` and `code` of each fix an un-narrowed `--fix` would refuse; those findings are not "fixable". */
	readonly refused?: ReadonlyArray<{ readonly file: string; readonly code: string }>;
	/** `--fix` was given: the refusals are printed above the summary, so it does not point at `--fix --dry-run`. */
	readonly fix?: boolean;
}) {
	const { diagnostics, cwd, bundleRoot, path } = options;
	const migrate = diagnostics.filter((d) => d.source === "migrate");
	const checked = diagnostics.filter((d) => d.source !== "migrate");
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
		errors: checked.filter((d) => d.severity === "error").length,
		warnings: checked.filter((d) => d.severity === "warning").length,
		info: checked.filter((d) => d.severity === "info").length,
		concepts: options.concepts,
	};
	yield* Console.error(summary(counts, displayRoot(cwd, bundleRoot, path)));
	if (options.target !== undefined) {
		const refusals = options.refused ?? [];
		const withFix = migrate.filter((d) => d.fix !== undefined);
		const refused = withFix.filter((d) => refusals.some((r) => r.file === d.file && r.code === d.code)).length;
		const refusedPart =
			refused > 0
				? `, ${refused} refused by --fix${options.fix === true ? "" : " (run with --fix --dry-run to see why)"}`
				: "";
		yield* Console.error(
			`OKF ${options.target}: ${migrate.length} finding(s), ${withFix.length - refused} fixable with --fix${refusedPart}`,
		);
	}
});
