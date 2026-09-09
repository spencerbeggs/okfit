import { randomUUID } from "node:crypto";
import { Effect, FileSystem, Option, Path } from "effect";

/**
 * S-33: the one atomic write every sync mode shares. Resolves `target`'s
 * real path first when it already exists (so a symlinked
 * `index.md`/`log.md`/concept file is replaced by writing through the
 * link rather than over it -- `generated` mode's own discipline, formerly
 * not shared with `index`/`log`) and falls back to `target` itself for a
 * file `sync` is about to create for the first time (`index`/`log` modes
 * both write files that may not exist yet; `generated` mode's targets
 * always exist, since they come from an already-loaded concept). Writes
 * `contents` to a uniquely-scoped temp file beside the resolved target (so
 * two concurrent `sync` runs never collide on a fixed name), preserves an
 * existing target's mode via `stat` + `chmod` (a brand-new file keeps
 * whatever mode `writeFileString` gives it), and renames the temp file
 * over the target. On any failure -- including a failed `rename` -- the
 * temp file is removed (`Effect.onError`), so a partial write never
 * leaves a stray `<file>.okfit-sync.<token>.tmp` behind (F-5/S-33).
 *
 * DISCREPANCY from S-33's literal "the temp name carries the pid": `src/`
 * outside `bin.ts`/`commands/*`/`internal/exit.ts`/`internal/tty.ts` never
 * reads the global `process` (K-39, enforced by `__test__/boundaries.test.ts`),
 * and `sync/write.ts` is not on that allowlist. A `randomUUID()` token
 * (`node:crypto`, not `process`) satisfies S-33's actual requirement --
 * two concurrent `sync` runs never collide on a fixed temp name -- without
 * widening the process-access boundary for one helper. Recorded here per
 * the Global Constraints' "record the discrepancy" instruction.
 *
 * @internal
 */
export const writeAtomic = Effect.fn("okfit/sync/writeAtomic")(function* (target: string, contents: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

	const resolved = yield* fs
		.realPath(target)
		.pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(target)));
	const dir = path.dirname(resolved);
	const base = path.basename(resolved);
	const tempPath = path.join(dir, `${base}.okfit-sync.${randomUUID()}.tmp`);
	const originalMode = yield* fs.stat(resolved).pipe(
		Effect.map((info) => Option.some(info.mode)),
		Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(Option.none<number>())),
	);

	yield* fs.writeFileString(tempPath, contents).pipe(
		Effect.tap(() =>
			Option.match(originalMode, { onNone: () => Effect.void, onSome: (mode) => fs.chmod(tempPath, mode) }),
		),
		Effect.tap(() => fs.rename(tempPath, resolved)),
		Effect.onError(() => fs.remove(tempPath, { force: true }).pipe(Effect.ignore)),
	);
});
