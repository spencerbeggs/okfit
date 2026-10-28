/**
 * The path syntax this server reads and writes `file:` URIs in.
 *
 * @remarks
 * `LspUri` is pure and never reads the running process, so every call passes
 * the platform explicitly. This is the single place the server picks it: the
 * host's own, read once at module load through `node:os`, since no file but the process boundary reads `process`. Every path the server turns into a URI
 * comes off the file system (a bundle root, an enumerated concept file), so
 * none of it is untrusted and `LspUri.fromPath`'s `TypeError` for Win32 device
 * and stream paths cannot be reached; client-supplied URIs only ever go
 * through `LspUri.toPath`, which answers `Option.none()` for what it refuses.
 *
 * @internal
 */
import { platform } from "node:os";
import type { LspUriOptions } from "@effected/lsp";

export const URI_OPTIONS: LspUriOptions = { platform: platform() === "win32" ? "win32" : "posix" };
