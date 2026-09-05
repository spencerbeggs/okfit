import type { RenderedDiagnostic } from "./sort.js";
import { sort } from "./sort.js";

/** The counts the summary line reports. @public */
export interface Counts {
	readonly errors: number;
	readonly warnings: number;
	readonly info: number;
	readonly concepts: number;
}

/** The ANSI escape character, built from its code point so the source never carries a raw control byte. */
const ESC = String.fromCharCode(27);

/** ANSI SGR codes for the severity word only (K-19); reset after, never applied elsewhere. */
const SEVERITY_COLOR: Record<RenderedDiagnostic["severity"], string> = {
	error: `${ESC}[31m`,
	warning: `${ESC}[33m`,
	info: `${ESC}[36m`,
};
const RESET = `${ESC}[0m`;

const colorize = (severity: RenderedDiagnostic["severity"], color: boolean): string =>
	color ? `${SEVERITY_COLOR[severity]}${severity}${RESET}` : severity;

/**
 * K-16. With a range:
 * `<file>:<range.line + 1>:<range.character + 1> <severity> <code> <message>`.
 * Without one: `<file> <severity> <code> <message>`. `file: ""` renders as
 * the literal `(bundle)`. Core's range is zero-based (D-32,
 * `CORE/Diagnostic.ts:49-57`); the `+ 1`s here are the only place it becomes
 * one-based. Colour, when `color` is `true`, wraps ONLY the severity word
 * (K-19) — never the code, the path, or the message.
 *
 * @public
 */
export const line = (diagnostic: RenderedDiagnostic, options?: { readonly color?: boolean }): string => {
	const color = options?.color ?? false;
	const file = diagnostic.file === "" ? "(bundle)" : diagnostic.file;
	const severity = colorize(diagnostic.severity, color);
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
	options?: { readonly color?: boolean },
): ReadonlyArray<string> => sort(diagnostics).map((d) => line(d, options));

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
