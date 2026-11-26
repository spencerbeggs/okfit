import { Fmt } from "@effected/cli-kit";

/**
 * Text drawn on one terminal line: `Fmt.sanitize` removes escape sequences and
 * other control characters and turns a tab into a space; each run of line
 * breaks (LF, CR) then prints as one space, so a value from a file cannot
 * forge a second line.
 *
 * @internal
 */
export const oneLine = (text: string): string => Fmt.sanitize(text).replace(/[\r\n]+/g, " ");
