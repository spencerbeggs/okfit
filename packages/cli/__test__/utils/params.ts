/**
 * Structural helpers for asserting on `effect/unstable/cli`'s `Flag`/`Argument`
 * values directly, never through `Command.run` (contract §6.1's
 * `commands.test.ts` row). Test-only, not part of the package's public
 * surface.
 *
 * Both helpers take `unknown`: a `Command`'s `config.flags`/`config.arguments`
 * are themselves untyped at the public `Command` interface (`config` is not
 * a declared member at all — every access below goes through an explicit
 * cast at the call site), and the nested `param` wrapper shape
 * (`Optional`/`Map`/…) is likewise internal, verified only against the
 * installed `Param.js`/`Primitive.js`.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/**
 * Unwraps `Optional`/`Map`/… layers down to the underlying `Single` and
 * returns its `name` — every `Flag`/`Argument` value, however it was built,
 * bottoms out at exactly one `Single` carrying the flag's or argument's own
 * name (verified against the installed `Param.js`: `Optional`/`Map` each
 * nest a `param`, `Single` alone carries `name`).
 */
export const nameOf = (value: unknown): string => {
	if (!isRecord(value)) throw new Error("expected a Flag/Argument param object");
	if (typeof value["name"] === "string") return value["name"];
	if ("param" in value) return nameOf(value["param"]);
	throw new Error("expected a nested `param` or a `name`");
};

/**
 * Unwraps down to the `Single`'s `primitiveType` (contract §6.1: inspecting
 * `--config`'s config object for `mustExist`). The installed `Primitive.path`
 * (`Primitive.js`) never serialises `mustExist` onto the returned object
 * regardless of whether it was passed — it is captured only in the parser
 * closure — so `"mustExist" in primitiveTypeOf(flag)` is `false` unconditionally;
 * asserting that absence is this contract row's own words, not a claim that
 * the flag ignores `mustExist` at parse time.
 */
export const primitiveTypeOf = (value: unknown): Record<string, unknown> => {
	if (!isRecord(value)) throw new Error("expected a Flag/Argument param object");
	if (isRecord(value["primitiveType"])) return value["primitiveType"];
	if ("param" in value) return primitiveTypeOf(value["param"]);
	throw new Error("expected a nested `param` or a `primitiveType`");
};
