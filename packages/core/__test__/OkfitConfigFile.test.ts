import { assert, describe, it } from "@effect/vitest";
import { ConfigFile, MergeStrategy, TomlCodec } from "@effected/config-file";
import { Toml } from "@effected/toml";
import { Duration, Effect, Schema } from "effect";
import { OkfitConfig, OkfitConfigFile } from "../src/OkfitConfig.js";
import { configPlatform, specExampleToml } from "./utils/configFixtures.js";

const CONFIG_PATH = "/repo/.config/okfit/config.toml";

const platform = configPlatform({
	[CONFIG_PATH]: specExampleToml,
	"/repo/broken.toml": "[bundle\npath = 1\n",
	"/repo/bad-duration.toml": '[lifecycle]\ndefault_stale_after = "soon"\n',
	"/repo/extra.toml": 'okf_version = "0.2"\n\n[mystery]\nlevel = 3\n',
});

describe("OkfitConfig.read", () => {
	it.effect("reads and decodes the spec example from a path", () =>
		Effect.gen(function* () {
			const config = yield* OkfitConfig.read(CONFIG_PATH);
			const expected = Schema.decodeUnknownSync(OkfitConfig)(yield* Toml.parse(specExampleToml));
			assert.deepStrictEqual(config, expected);
			assert.isTrue(Duration.equals(config.lifecycle!.default_stale_after!, Duration.days(90)));
		}).pipe(Effect.provide(platform)),
	);
	it.effect("keeps an unknown top-level table in extensions at warning severity", () =>
		Effect.gen(function* () {
			const config = yield* OkfitConfig.read("/repo/extra.toml");
			assert.deepStrictEqual({ ...config.extensions }, { mystery: { level: 3 } });
			assert.strictEqual(OkfitConfig.severityFor(config, "config-unknown-key"), "warning");
		}).pipe(Effect.provide(platform)),
	);
	it.effect("fails typed: missing path, malformed TOML, bad value", () =>
		Effect.gen(function* () {
			assert.strictEqual((yield* Effect.flip(OkfitConfig.read("/repo/nope.toml")))._tag, "ConfigFileReadError");
			assert.strictEqual((yield* Effect.flip(OkfitConfig.read("/repo/broken.toml")))._tag, "ConfigCodecError");
			assert.strictEqual(
				(yield* Effect.flip(OkfitConfig.read("/repo/bad-duration.toml")))._tag,
				"ConfigValidationError",
			);
		}).pipe(Effect.provide(platform)),
	);
});

describe("OkfitConfigFile", () => {
	it.effect("is a ConfigFile service tag a layer can provide", () =>
		Effect.gen(function* () {
			const service = yield* OkfitConfigFile;
			const config = yield* service.load;
			assert.strictEqual(config.bundle!.profile, "software-project");
			assert.deepStrictEqual(config.actors, {
				agent: "okfit/claude-code",
				humans: ["human:spencer"],
			} as unknown as typeof config.actors);
		}).pipe(
			Effect.provide(
				ConfigFile.testLayer(OkfitConfigFile, {
					schema: OkfitConfig,
					codec: TomlCodec,
					strategy: MergeStrategy.firstMatch<OkfitConfig>(),
					files: { "config.toml": specExampleToml },
				}),
			),
			Effect.provide(platform),
		),
	);
	it("carries the shared service identity", () => {
		assert.strictEqual(OkfitConfigFile.key, "@okfit/core/OkfitConfigFile");
	});
});
