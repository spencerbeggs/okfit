import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { Bundle } from "../src/Bundle.js";
import { OkfitConfig } from "../src/OkfitConfig.js";
import { Validate } from "../src/Validate.js";

const message = (configured: string, declared: string) =>
	`okf_version in the config is "${configured}", but the bundle-root index.md declares "${declared}"; okfit reads the bundle as "${declared}" and uses the config value only for a root index that declares none. Set okf_version = "${declared}" in the config, or remove it`;

const messageAt = (where: string, configured: string, declared: string) =>
	`okf_version ${where} is "${configured}", but the bundle-root index.md declares "${declared}"; okfit reads the bundle as "${declared}" and uses the config value only for a root index that declares none. Set okf_version = "${declared}" ${where}, or remove it`;

const unparsableMessage = (where: string, configured: string, declared: string) =>
	`okf_version ${where} is "${configured}", but the bundle-root index.md declares "${declared}", which is not a <major>.<minor> version; correct the declaration in index.md, then set okf_version ${where} to the same value, or remove it`;

const index = (declared: string | undefined) =>
	declared === undefined ? "# Index\n" : `---\nokf_version: ${declared}\n---\n\n# Index\n`;

const load = (rootIndex: string) => {
	const mount = "/repo/config-okf-version";
	return Effect.provide(
		Bundle.load({ root: mount }),
		Layer.mergeAll(MemoryFileSystem.layerWith({ [`${mount}/index.md`]: rootIndex }), Path.layer),
	);
};

const stale = (bundle: Parameters<typeof Validate.lint>[0], config: OkfitConfig, configPath?: string) =>
	Validate.lint(bundle, config, configPath === undefined ? {} : { configPath }).filter(
		(d) => d.code === "config-okf-version-stale",
	);

const withVersion = (okf_version: string | undefined, lint?: OkfitConfig["lint"]): OkfitConfig => ({
	...OkfitConfig.DEFAULTS,
	...(okf_version === undefined ? {} : { okf_version }),
	...(lint === undefined ? {} : { lint: { ...OkfitConfig.DEFAULTS.lint, ...lint } }),
});

describe("config-okf-version-stale", () => {
	it.effect("fires when the config says 0.2 and the index declares 0.3", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"0.3"'));
			const found = stale(bundle, withVersion("0.2"));
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0]?.file, "");
			assert.strictEqual(found[0]?.severity, "warning");
			assert.strictEqual(found[0]?.message, message("0.2", "0.3"));
		}),
	);

	it.effect("silent when they agree", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"0.3"'));
			assert.deepStrictEqual(stale(bundle, withVersion("0.3")), []);
			assert.strictEqual(stale(bundle, withVersion("0.2")).length, 1, "control: a difference fires");
		}),
	);

	it.effect("silent when the config sets none", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"0.3"'));
			assert.deepStrictEqual(stale(bundle, withVersion(undefined)), []);
			assert.strictEqual(stale(bundle, withVersion("0.2")).length, 1, "control: with a value it fires");
		}),
	);

	it.effect("silent when the index declares none", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index(undefined));
			assert.deepStrictEqual(stale(bundle, withVersion("0.3")), []);
			const control = yield* load(index('"0.2"'));
			assert.strictEqual(stale(control, withVersion("0.3")).length, 1, "control: a declaring index fires");
		}),
	);

	it.effect('"0.3" and "0.3" written differently but parsing equal are silent', () =>
		Effect.gen(function* () {
			const bundle = yield* load(index("'0.3'"));
			assert.deepStrictEqual(stale(bundle, withVersion("0.3")), []);
			const control = yield* load(index("'0.3'"));
			assert.strictEqual(stale(control, withVersion("0.2")).length, 1, "control: a real difference fires");
		}),
	);

	it.effect("0.3 and 0.03 parse equal (numeric compare), 0.3 and 0.30 do not", () =>
		Effect.gen(function* () {
			const padded = yield* load(index('"0.03"'));
			assert.deepStrictEqual(stale(padded, withVersion("0.3")), [], "equal numerically, different strings: silent");
			const wider = yield* load(index('"0.30"'));
			assert.strictEqual(stale(wider, withVersion("0.3")).length, 1, "0.30 is minor 30, not 3: fires");
		}),
	);

	it.effect("silent when the root index has frontmatter but no okf_version", () =>
		Effect.gen(function* () {
			const bundle = yield* load("---\ntitle: Notes\n---\n\n# Index\n");
			assert.deepStrictEqual(stale(bundle, withVersion("0.3")), []);
			const control = yield* load(index('"0.2"'));
			assert.strictEqual(stale(control, withVersion("0.3")).length, 1, "control: a declared version fires");
		}),
	);

	it.effect("an unparsable declaration is compared as a string", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"v0.3"'));
			const found = stale(bundle, withVersion("0.3"));
			assert.strictEqual(found.length, 1);
			assert.strictEqual(found[0]?.message, unparsableMessage("in the config", "0.3", "v0.3"));
			assert.deepStrictEqual(stale(bundle, withVersion("v0.3")), [], "control: equal strings are silent");
		}),
	);

	it.effect('config_okf_version_stale = "off" silences it', () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"0.3"'));
			assert.deepStrictEqual(stale(bundle, withVersion("0.2", { config_okf_version_stale: "off" })), []);
			assert.strictEqual(stale(bundle, withVersion("0.2")).length, 1, "control: the default fires");
		}),
	);

	it.effect("names the config file when the path is known (#499)", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"0.3"'));
			const found = stale(bundle, withVersion("0.2"), "/p/okfit.toml");
			assert.strictEqual(found[0]?.message, messageAt("in /p/okfit.toml", "0.2", "0.3"));
		}),
	);

	it.effect("keeps 'in the config' without a path", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"0.3"'));
			assert.strictEqual(stale(bundle, withVersion("0.2"))[0]?.message, messageAt("in the config", "0.2", "0.3"));
		}),
	);

	it.effect("never offers an unparsable declaration as the value to set (#499)", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"0.3.0"'));
			const found = stale(bundle, withVersion("0.3"), "/p/okfit.toml");
			assert.strictEqual(found[0]?.message, unparsableMessage("in /p/okfit.toml", "0.3", "0.3.0"));
			assert.isFalse(found[0]?.message.includes('Set okf_version = "0.3.0"'));
		}),
	);

	it.effect("a declaration of 9.9 parses, so the first form applies", () =>
		Effect.gen(function* () {
			const bundle = yield* load(index('"9.9"'));
			assert.strictEqual(stale(bundle, withVersion("0.3"))[0]?.message, messageAt("in the config", "0.3", "9.9"));
		}),
	);
});
