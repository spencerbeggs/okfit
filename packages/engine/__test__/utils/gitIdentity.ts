import { Effect, Option } from "effect";

/**
 * A fake `Git.configGet` that answers by key: `user.name` is "Ada",
 * `user.email` is "ada@example.com" (so the resolved actor is `human:ada`),
 * and every other key, `okfit.actor` included, is `Option.none()`.
 */
export const identityConfigGet = (_cwd: string, key: string): Effect.Effect<Option.Option<string>> =>
	Effect.succeed(
		key === "user.name" ? Option.some("Ada") : key === "user.email" ? Option.some("ada@example.com") : Option.none(),
	);
