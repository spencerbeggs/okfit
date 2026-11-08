import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LspProcess } from "@effected/lsp/testing";
import type { Effect, PlatformError, Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { ChildProcess } from "effect/process";

/** The built bin, resolved from this file's own location, never from cwd. */
export const LSP_BIN: string = resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"dist",
	"prod",
	"npm",
	"pkg",
	"bin",
	"okfit-lsp.js",
);

/**
 * Node arguments that load tsx in the spawned child. The built bin imports its workspace siblings,
 * and those links resolve to their `src/`, so the child needs tsx; a hermetic env inherits no
 * `nodeOptions` and the child's cwd is a sandbox, so the loader is named by absolute URL.
 */
export const TSX_IMPORT: ReadonlyArray<string> = [
	"--import",
	pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
];

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
	LspProcess.spawn(ChildProcess.make(process.execPath, [...TSX_IMPORT, LSP_BIN, "--stdio", ...extraArgs], { env }));
