import type { OkfitConfig } from "@okfit/core";
import type { Option, Path } from "effect";

/**
 * What {@link resolveProjectRoot} needs about the winning discovery source
 * (K-12, K-58). Narrower than `@effected/config-file`'s own
 * `ConfigSource`: only `path`, `resolver` and the match's `dir` matter for
 * anchoring, and a caller building this from a real
 * `ConfigSource<OkfitConfig>` simply drops `value`.
 *
 * @public
 */
export interface DiscoveredConfig {
	/** `ConfigSource.path` — absolute. */
	readonly path: string;
	/** `ConfigSource.resolver` — the resolver's `name`. */
	readonly resolver: string;
	/**
	 * `ConfigSource.match?.dir` — the ancestor directory `upwardWalk`
	 * anchored the winning candidate against. Absent when the resolver did
	 * not implement `resolveMatch`, or reported no `dir` (`explicitPath`
	 * never does, by design).
	 */
	readonly dir?: string;
}

/**
 * The explicit `--config` anchor rule (C-8): the parent of `.config` "if the
 * file sits in a `.config` directory, else the file's directory", with no
 * exception for a custom name. Upstream's `ConfigResolver.explicitPath`
 * reports no `dir` in its `match` by design, so this stays a hand-rolled,
 * basename-based rule rather than reading `ConfigMatch.dir` — the one
 * remaining path-tail string match in the CLI outside `init/scaffold.ts`
 * (C1-4).
 */
const anchorForExplicit = (configPath: string, path: Path.Path): string => {
	const parent = path.dirname(configPath);
	return path.basename(parent) === ".config" ? path.dirname(parent) : parent;
};

/**
 * K-12's project root, as amended by K-58 and C1-2, in order:
 *
 * 1. `pathArg`, if given. `Argument.path` has already resolved it absolute.
 * 2. otherwise, if `--config` was given: `anchorForExplicit` applied to that
 *    path.
 * 3. otherwise, if a config was discovered by the `"project"` resolver
 *    (`ConfigResolver.upwardWalk`, named `"project"` in `layer.ts`) AND it
 *    reported a `dir`: that `dir` verbatim — it is already the ancestor
 *    `upwardWalk` anchored the match against (the parent of `.config` for a
 *    `.config/okfit.toml` candidate, the candidate's own directory
 *    otherwise), so no path-tail test is needed here any more.
 * 4. otherwise `cwd` — this covers every other resolver name (`"xdg"`,
 *    `"native"`, `"system"`) as defence in depth, a `"project"` match with no
 *    `dir` (should not happen, since `upwardWalk` always reports one), and
 *    no discovery at all.
 *
 * The CLI never probes for `.git` (K-12), even though
 * `ConfigResolver.gitRoot` exists.
 *
 * @public
 */
export const resolveProjectRoot = (input: {
	readonly pathArg: Option.Option<string>;
	readonly explicitConfigPath: Option.Option<string>;
	readonly discovered: Option.Option<DiscoveredConfig>;
	readonly cwd: string;
	readonly path: Path.Path;
}): string => {
	if (input.pathArg._tag === "Some") return input.pathArg.value;
	if (input.explicitConfigPath._tag === "Some") return anchorForExplicit(input.explicitConfigPath.value, input.path);
	if (input.discovered._tag === "Some") {
		const discovered = input.discovered.value;
		if (discovered.resolver === "project" && discovered.dir !== undefined) {
			return discovered.dir;
		}
	}
	return input.cwd;
};

/**
 * `<project root>/<bundle.path>`, absolute (K-2). `config` is the MERGED
 * config, so `bundle.path` is `OkfitConfig.DEFAULTS.bundle.path` (`"okf"`)
 * unless a file or profile overrode it. The bundle root is never what
 * `[path]` names.
 *
 * @public
 */
export const resolveBundleRoot = (projectRoot: string, config: OkfitConfig, path: Path.Path): string =>
	path.resolve(projectRoot, config.bundle?.path ?? "okf");
