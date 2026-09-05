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
			discovered: Option.some<DiscoveredConfig>({ path: "/repo/.config/okfit/config.toml", resolver: "walk" }),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/explicit/root");
	});

	it("anchors an explicit --config three directories up from .config/okfit/config.toml", () => {
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.some("/repo/.config/okfit/config.toml"),
			discovered: Option.none(),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo");
	});

	it("anchors an explicit --config at its own directory for any other filename", () => {
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.some("/repo/nested/okfit.config.toml"),
			discovered: Option.none(),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo/nested");
	});

	it("a .config/okfit/config.toml discovered by a project-local walk anchors three up", () => {
		const discovered: DiscoveredConfig = { path: "/repo/.config/okfit/config.toml", resolver: "walk" };
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.none(),
			discovered: Option.some(discovered),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo");
	});

	it("an okfit.config.toml discovered by a project-local walk anchors at its own directory", () => {
		const discovered: DiscoveredConfig = { path: "/repo/okfit.config.toml", resolver: "walk" };
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.none(),
			discovered: Option.some(discovered),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/repo");
	});

	it("a config discovered by the xdg resolver carries no project anchor", () => {
		const discovered: DiscoveredConfig = { path: "/home/user/.config/okfit/config.toml", resolver: "xdg" };
		const root = resolveProjectRoot({
			pathArg: Option.none(),
			explicitConfigPath: Option.none(),
			discovered: Option.some(discovered),
			cwd: "/cwd",
			path,
		});
		assert.strictEqual(root, "/cwd");
	});

	it("a config discovered by the native resolver also carries no project anchor", () => {
		const discovered: DiscoveredConfig = {
			path: "/home/user/Library/Application Support/okfit/config.toml",
			resolver: "native",
		};
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
