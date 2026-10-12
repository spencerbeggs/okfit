import type { LoadedBundle } from "@okfit/core";
import type { RenderedDiagnostic } from "@okfit/engine";
import { Targets } from "@okfit/engine";
import { Effect } from "effect";

/**
 * Narrow a rendered diagnostic list to the named targets. With no targets the
 * list is returned unchanged; otherwise each target resolves (any bundle file
 * is accepted, so an `index.md` or an undecodable file stays checkable) and
 * only diagnostics whose bundle-relative `file` is among them survive.
 *
 * @internal
 */
export const scopeTo = (
	diagnostics: ReadonlyArray<RenderedDiagnostic>,
	targets: ReadonlyArray<string>,
	bundle: LoadedBundle,
	cwd: string,
) =>
	targets.length === 0
		? Effect.succeed(diagnostics)
		: Targets.resolve(targets, bundle, cwd, { files: true }).pipe(
				Effect.map((resolved) => {
					const scope = new Set(resolved.map((target) => target.path));
					return diagnostics.filter((diagnostic) => scope.has(diagnostic.file));
				}),
			);
