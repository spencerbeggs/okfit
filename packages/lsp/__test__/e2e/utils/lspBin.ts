import { resolve } from "node:path";
import { LspProcess } from "@effected/lsp/testing";
import type { Effect, PlatformError, Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { ChildProcess } from "effect/process";

/** The built dev bin, resolved from this file's own location, never from cwd. */
export const LSP_BIN: string = resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"dist",
	"dev",
	"pkg",
	"bin",
	"okfit-lsp.js",
);

/**
 * Spawn the built LSP bin as a long-lived server with `--stdio` (accepted and
 * ignored; see `protocol/reference.ts`) over the kit's `LspProcess`, with an
 * explicit `env`. `extraArgs` follow `--stdio` (for example
 * `--clientProcessId=<pid>`).
 */
export const spawnLsp = (
	env: Readonly<Record<string, string>>,
	extraArgs: ReadonlyArray<string> = [],
): Effect.Effect<LspProcess, PlatformError.PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
	LspProcess.spawn(ChildProcess.make(process.execPath, [LSP_BIN, "--stdio", ...extraArgs], { env }));
