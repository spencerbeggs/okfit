import type { DateTime } from "effect";
import { Context } from "effect";

/**
 * K-47's ambient clock. `bin.ts` resolves `OKFIT_NOW` (or the wall clock)
 * exactly once and provides it with `Effect.provideService(Now, value)`
 * around the whole command tree; `commands/validate.ts` (Group D) and
 * `commands/init.ts` (Group E) each read it with `const now = yield* Now;` before
 * building a `RunOptions` or a scaffold's `today`. Not re-exported from
 * `index.ts`: like `internal/exit.ts` and `internal/tty.ts`, it means
 * nothing outside a spawned process (K-49).
 *
 * `Context.Tag` does not exist on this Effect line (rc.109); the v4 shape is
 * `Context.Service<Self, Shape>()(id)`, the same form core and profiles use
 * for their own services (`PROFILES/GitHistory.ts:140`).
 *
 * This module carries only this service in this group; `run`, `RunOptions`,
 * and `RunResult` (K-48's load-validate-check pipeline) are appended by Task
 * C5 without moving or renaming this export.
 *
 * @public
 */
export class Now extends Context.Service<Now, DateTime.Utc>()("@okfit/cli/Now") {}
