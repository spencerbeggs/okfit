import type { Document } from "@effected/cli";
import { Doc } from "@effected/cli";
import type { RenderedDiagnostic } from "@okfit/engine";
import { sort } from "@okfit/engine";
import type { Path } from "effect";

/** The counts the summary line reports. @public */
export interface Counts {
	readonly errors: number;
	readonly warnings: number;
	readonly info: number;
	readonly concepts: number;
}

/**
 * Paints one severity word. `CliTheme`'s `paint` fits as-is: severities are
 * a subset of its token names, and it is the identity when colour is `none`
 * (#217 retired this module's hand-rolled ANSI table onto the theme).
 *
 * @public
 */
export type SeverityPaint = (severity: RenderedDiagnostic["severity"], text: string) => string;

/**
 * K-16. With a range:
 * `<file>:<range.line + 1>:<range.character + 1> <severity> <code> <message>`.
 * Without one: `<file> <severity> <code> <message>`. `file: ""` renders as
 * the literal `(bundle)`. Core's range is zero-based (D-32,
 * `CORE/Diagnostic.ts:49-57`); the `+ 1`s here are the only place it becomes
 * one-based. Colour, when a `paint` is given, wraps ONLY the severity word
 * (K-19) — never the code, the path, or the message.
 *
 * @public
 */
export const line = (diagnostic: RenderedDiagnostic, options?: { readonly paint?: SeverityPaint }): string => {
	const file = diagnostic.file === "" ? "(bundle)" : diagnostic.file;
	const severity =
		options?.paint === undefined ? diagnostic.severity : options.paint(diagnostic.severity, diagnostic.severity);
	const location =
		diagnostic.range === undefined ? file : `${file}:${diagnostic.range.line + 1}:${diagnostic.range.character + 1}`;
	return `${location} ${severity} ${diagnostic.code} ${diagnostic.message}`;
};

/**
 * `sort` then `line` over the whole set: the exact stdout body of
 * `--format human`, one array element per stdout line.
 *
 * @public
 */
export const human = (
	diagnostics: ReadonlyArray<RenderedDiagnostic>,
	options?: { readonly paint?: SeverityPaint },
): ReadonlyArray<string> => sort(diagnostics).map((d) => line(d, options));

/** Where a diagnostic's file lives, so `humanDoc` can link and annotate it. @public */
export interface HumanDocOptions {
	/** Absolute bundle root: file links (OSC 8, `vscode://`) resolve against it. Omit for no file links. */
	readonly root?: string;
	/**
	 * Bundle root as the CI runner sees it (workspace-relative, e.g. `okf`; see {@link annotationDir}): prefixes the
	 * annotation `file`. `.` or omitted = no prefix; `null` = the bundle is not addressable from the runner, so the
	 * annotation carries no `file`.
	 */
	readonly annotationDir?: string | null;
}

/**
 * The bundle root as GitHub resolves an annotation `file`: relative to
 * `GITHUB_WORKSPACE` when it is set, else to `cwd`. `.` is the base itself;
 * `null` is a bundle outside the base (its path would be absolute or leave
 * it through `..`), where an annotation can name no file.
 *
 * @public
 */
export const annotationDir = (
	cwd: string,
	bundleRoot: string,
	workspace: string | undefined,
	path: Path.Path,
): string | null => {
	const rel = path.relative(workspace ?? cwd, bundleRoot);
	if (rel === "") return ".";
	return rel === ".." || rel.startsWith("../") || path.isAbsolute(rel) ? null : rel;
};

const LEVEL = { error: "error", warning: "warning", info: "notice" } as const;

/**
 * The `Doc` form of {@link human}: per sorted diagnostic one paragraph with
 * the K-16 line shape (the severity word alone carries its token, K-19; the
 * `file:line:col` prefix is a link when `root` is given), then a GitHub
 * annotation block that only `Render.githubLog` writes. Plain output is
 * byte-identical to `human(...).join("\n")`.
 *
 * @public
 */
export const humanDoc = (diagnostics: ReadonlyArray<RenderedDiagnostic>, options?: HumanDocOptions): Document =>
	sort(diagnostics).flatMap((d) => {
		const label = d.file === "" ? "(bundle)" : d.file;
		const position = d.range === undefined ? undefined : { line: d.range.line + 1, col: d.range.character + 1 };
		const location = position === undefined ? label : `${label}:${position.line}:${position.col}`;
		const target =
			d.file === "" || options?.root === undefined ? undefined : { file: `${options.root}/${d.file}`, ...position };
		const dir = options?.annotationDir;
		const annotationFile =
			d.file === "" || dir === null ? undefined : dir === undefined || dir === "." ? d.file : `${dir}/${d.file}`;
		return [
			Doc.line(
				[
					Doc.link(target, location, { suffix: false }),
					" ",
					Doc.text(d.severity, d.severity),
					` ${d.code} ${d.message}`,
				],
				{ wrap: false },
			),
			Doc.annotation(
				{
					level: LEVEL[d.severity],
					...(annotationFile === undefined ? {} : { file: annotationFile }),
					...(position === undefined ? {} : position),
				},
				`${d.code} ${d.message}`,
			),
		];
	});

/**
 * K-20, verbatim and unpluralised —
 * `<E> errors, <W> warnings, <I> info in <N> concepts (<root>)`. `root` is
 * pre-rendered by the caller: relative to cwd when under it, absolute
 * otherwise (K-51).
 *
 * @public
 */
export const summary = (counts: Counts, root: string): string =>
	`${counts.errors} errors, ${counts.warnings} warnings, ${counts.info} info in ${counts.concepts} concepts (${root})`;

/**
 * The one K-51 display-path rule, shared by both `commands/validate.ts`'s
 * `summary` root and `commands/init.ts`'s success line: `target` relative
 * to `cwd` when it is under it, absolute otherwise. Three cases, in order:
 *
 * 1. `target === cwd` (`path.relative` returns `""`): the literal `.`.
 * 2. The relative form starts with `..`, or is itself absolute (a target on
 *    a different root than `cwd`, where `Path.relative` can return an
 *    absolute path unchanged depending on the platform): `target`
 *    unchanged, absolute.
 * 3. Otherwise: the relative form.
 *
 * @internal
 */
export const displayRoot = (cwd: string, target: string, path: Path.Path): string => {
	const relative = path.relative(cwd, target);
	if (relative === "") return ".";
	return relative.startsWith("..") || path.isAbsolute(relative) ? target : relative;
};
