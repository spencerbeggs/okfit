import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The repository root, resolved from this file's own location. */
export const REPO_ROOT: string = resolve(import.meta.dirname, "..", "..", "..", "..", "..");

/** The built `okfit-mcp` bin, resolved from this file's own location, never from cwd. */
export const MCP_BIN: string = resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"dist",
	"prod",
	"npm",
	"pkg",
	"bin",
	"okfit-mcp.js",
);

/** The built `okfit` bin of `@okfit/cli`. */
export const CLI_BIN: string = resolve(REPO_ROOT, "packages", "cli", "dist", "prod", "npm", "pkg", "bin", "okfit.js");

/**
 * Node arguments that load tsx in the spawned child. The built bin imports its workspace siblings,
 * and those links resolve to their `src/`, so the child needs tsx; a hermetic env inherits no
 * `nodeOptions` and the child's cwd is a sandbox, so the loader is named by absolute URL.
 */
export const TSX_IMPORT: ReadonlyArray<string> = [
	"--import",
	pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
];
