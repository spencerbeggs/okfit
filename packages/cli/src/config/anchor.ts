import type { OkfitConfig } from "@okfit/core";
import type { Option, Path } from "effect";

/**
 * What {@link resolveProjectRoot} needs about the winning discovery source
 * (K-12, K-58). Narrower than `@effected/config-file`'s own
 * `ConfigSource`: only `path` and `resolver` matter for anchoring, and
 * a caller building this from a real `ConfigSource<OkfitConfig>` simply
 * drops `value`.
 *
 * @public
 */
export interface DiscoveredConfig {
	/** `ConfigSource.path` — absolute. */
	readonly path: string;
	/** `ConfigSource.resolver` — the resolver's `name`. */
	readonly resolver: string;
}

/**
 * The anchor rule (C-8). `.config/okfit.toml` anchors at the PARENT of
 * `.config`; `.okfit.toml` and `okfit.toml` anchor at their own directory;
 * an explicit `--config` path takes the same two-way test. Keyed on a
 * two-segment tail rather than on the resolver name, because
 * `ConfigSource<A>` is a fixed `{ path, resolver, value }` and no fourth
 * field can be threaded through `ConfigFile.discover` (J-4) — but the tail
 * is now unambiguous: `"project"` is one resolver, and no other tier can
 * produce `<dir>/.config/okfit.toml`.
 */
const anchorFor = (configPath: string, path: Path.Path): string => {
	const filename = path.basename(configPath);
	const parent = path.dirname(configPath);
	if (filename === "okfit.toml" && path.basename(parent) === ".config") {
		return path.dirname(parent);
	}
	return parent;
};

/**
 * K-12's project root, as amended by K-58, in order:
 *
 * 1. `pathArg`, if given. `Argument.path` has already resolved it absolute.
 * 2. otherwise, if `--config` was given: `anchorFor` applied to that path.
 * 3. otherwise, if a config was discovered by a project-local resolver (not
 *    `"xdg"`, `"native"` or `"system"`): `anchorFor` applied to
 *    `discovered.path`.
 * 4. otherwise `cwd` — an XDG-sourced config carries no project anchor, and
 *    neither does no config at all.
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
	if (input.explicitConfigPath._tag === "Some") return anchorFor(input.explicitConfigPath.value, input.path);
	if (input.discovered._tag === "Some") {
		const discovered = input.discovered.value;
		if (discovered.resolver !== "xdg" && discovered.resolver !== "native" && discovered.resolver !== "system") {
			return anchorFor(discovered.path, input.path);
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
