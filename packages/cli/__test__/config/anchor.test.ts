import { assert, describe, it } from "@effect/vitest";
import { OkfitConfig } from "@okfit/core";
import { Effect, Option, Path } from "effect";
import type { DiscoveredConfig } from "../../src/config/anchor.js";
import { resolveBundleRoot, resolveProjectRoot } from "../../src/config/anchor.js";

// effect's own POSIX Path layer needs no FileSystem and no Node import (EF/Path.ts:867);
// resolved once and reused as a plain value across every case (K-12, K-58).
const path: Path.Path = Effect.runSync(Effect.provide(Path.Path, Path.layer));

describe("resolveProjectRoot", () => {
	it("pathArg wins outright over --config and a discovered source", () => {
		const root = resolveProjectRoot({
			pathArg: Option.some("/explicit/root"),
			explicitConfigPath: Option.some("/other/dir/config.toml"),
			discovered: Option.some<DiscoveredConfig>({
				path: "/repo/.config/okfit.toml",
				resolver: "project",
				dir: "/repo",
			}),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/explicit/root");
	});

	it("anchors .config/okfit.toml at the parent of .config (the match's dir, verbatim)", () => {
		const discovered: DiscoveredConfig = { path: "/repo/.config/okfit.toml", resolver: "project", dir: "/repo" };
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.none(),
			discovered: Option.some(discovered),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo");
	});

	it("anchors okfit.toml at its own directory (the match's dir, verbatim)", () => {
		const discovered: DiscoveredConfig = { path: "/repo/nested/okfit.toml", resolver: "project", dir: "/repo/nested" };
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.none(),
			discovered: Option.some(discovered),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo/nested");
	});

	it("anchors .okfit.toml at its own directory (the match's dir, verbatim)", () => {
		const discovered: DiscoveredConfig = {
			path: "/repo/nested/.okfit.toml",
			resolver: "project",
			dir: "/repo/nested",
		};
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.none(),
			discovered: Option.some(discovered),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo/nested");
	});

	it("anchors an explicit --config inside .config at the parent of .config", () => {
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.some("/repo/.config/okfit.toml"),
			discovered: Option.none(),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo");
	});

	it("anchors an explicit --config with a custom name inside .config at the parent of .config", () => {
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.some("/repo/.config/custom.toml"),
			discovered: Option.none(),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo");
	});

	it("anchors any other explicit --config at the file's own directory", () => {
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.some("/repo/nested/myconfig.toml"),
			discovered: Option.none(),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo/nested");
	});

	it("falls back to cwd for the xdg, native, and system resolvers", () => {
		const sources: ReadonlyArray<DiscoveredConfig> = [
			{ path: "/home/user/.config/okfit/config.toml", resolver: "xdg" },
			{ path: "/home/user/Library/Application Support/okfit/config.toml", resolver: "native" },
			{ path: "/etc/okfit/config.toml", resolver: "system" },
		];
		for (const discovered of sources) {
			assert.strictEqual(
				resolveProjectRoot({
					pathArg: Option.none(),
					explicitConfigPath: Option.none(),
					discovered: Option.some(discovered),
					cwd: "/cwd",
					path,
				}),
				"/cwd",
				discovered.resolver,
			);
		}
	});

	it("falls back to cwd for a project match reporting no dir (defence in depth)", () => {
		const discovered: DiscoveredConfig = { path: "/repo/okfit.toml", resolver: "project" };
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.none(),
			discovered: Option.some(discovered),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/cwd");
	});

	it("falls back to cwd when nothing was given and nothing was discovered", () => {
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.none(),
			discovered: Option.none(),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/cwd");
	});
});

describe("resolveBundleRoot", () => {
	it("resolves against the merged config's bundle.path when set", () => {
		const config: OkfitConfig = { ...OkfitConfig.DEFAULTS, bundle: { path: "docs", profile: "software-project" } };
		assert.strictEqual(resolveBundleRoot("/repo", config, path), "/repo/docs");
	});

	it('falls back to the literal default "okf" when the config carries no bundle.path', () => {
		const { bundle: _bundle, ...withoutBundle } = OkfitConfig.DEFAULTS;
		assert.strictEqual(resolveBundleRoot("/repo", withoutBundle, path), "/repo/okf");
	});

	it("DEFAULTS itself already resolves to okf (the caller's usual merged input)", () => {
		assert.strictEqual(resolveBundleRoot("/repo", OkfitConfig.DEFAULTS, path), "/repo/okf");
	});
});
