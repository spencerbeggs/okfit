import { Git } from "@effected/git";
import type { Layer } from "effect";
import { Effect, Option } from "effect";

/** One recorded `configGet` call: the key and the options object exactly as passed (`undefined` means merged scope, P-15). */
export interface ConfigGetCall {
	readonly key: string;
	readonly options: unknown;
}

/**
 * A `Git` double answering `configGet` from `values` (a missing key is `Option.none`) and recording every
 * call into `calls`; every other member dies (GIT/index.d.ts:1958-1970).
 */
export const identityGit = (
	values: Readonly<Record<string, string>>,
	calls: Array<ConfigGetCall> = [],
): Layer.Layer<Git> =>
	Git.layerTest({
		configGet: (_cwd, key, options) => {
			calls.push({ key, options });
			const value = values[key];
			return Effect.succeed(value === undefined ? Option.none<string>() : Option.some(value));
		},
	});
