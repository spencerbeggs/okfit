import { CliInteractive } from "@effected/cli";
import { CliUi, Confirm } from "@effected/cli/ui";
import type { OkfitConfig } from "@okfit/core";
import type { ChangeSince } from "@okfit/engine";
import { changeSince, inspectDrift } from "@okfit/engine";
import type { DateTime } from "effect";
import { Console, Effect } from "effect";

const REASON_TEXT = {
	"content-changed": "its content has changed since it was verified",
	unbound: "no integrity binding records what was verified",
	"entry-superseded": "a later verification is not the one its integrity binding covers",
	"actor-not-allowed": "its verifier is not in [actors].humans",
} as const;

/**
 * An interactive single-id `okfit verify <id>` on a drifted concept shows what
 * changed since the verification was bound and asks `Re-verify <id>?` before
 * `runVerify` writes anything. Resolves to `false` when the person declines
 * (the caller exits 0 with nothing written) and to `true` for everything else:
 * not drifted, not interactive, `--no-diff`, `--dry-run`, or a prompt that
 * cannot mount (a pipe never blocks).
 *
 * The gate is `CliInteractive`, the same audience and terminal decision
 * `syncWithConfirm` uses: a person on a terminal, never the agent or CI
 * audience, never a pipe, and never `--format json` (the caller narrows that
 * before it gets here). A drifted concept in those runs still reports its
 * reason through `VerifyResult.priorDrift` (JSON `prior_integrity`).
 *
 * A git failure reading the history degrades to a note and still asks: the
 * person can re-verify without the patch.
 */
export const confirmReverify = (options: {
	readonly id: string;
	readonly bundleRoot: string;
	readonly config: OkfitConfig;
	readonly now: DateTime.Utc;
	readonly noDiff: boolean;
	readonly dryRun: boolean;
}) =>
	Effect.gen(function* () {
		if (options.noDiff || options.dryRun || !(yield* CliInteractive)) return true;
		const inspection = yield* inspectDrift({
			id: options.id,
			bundleRoot: options.bundleRoot,
			config: options.config,
			now: options.now,
		});
		if (inspection.drift === null) return true;
		const change: ChangeSince | undefined =
			inspection.drift === "unbound" || inspection.boundAt === undefined
				? ({ _tag: "no-baseline", reason: "unbound" } satisfies ChangeSince)
				: yield* changeSince({ file: inspection.absolutePath, at: inspection.boundAt }).pipe(
						Effect.catchTag("GitCommandError", () => Effect.succeed(undefined)),
					);
		yield* Console.log(`${inspection.id}: ${REASON_TEXT[inspection.drift]}`);
		if (change === undefined) yield* Console.log("could not read git history to show what changed");
		else if (change._tag === "no-baseline") yield* Console.log(`no baseline to compare: ${change.reason}`);
		else {
			yield* Console.log(`changed since ${change.baseline}:`);
			yield* Console.log(change.patch.length === 0 ? "(no textual difference)" : change.patch.replace(/\n$/, ""));
		}
		const answer = yield* CliUi.prompt(Confirm.screen({ message: `Re-verify ${inspection.id}?`, initial: false })).pipe(
			Effect.catchTag("NotInteractive", () => Effect.succeed(undefined)),
		);
		return answer === undefined || answer.confirmed;
	});
