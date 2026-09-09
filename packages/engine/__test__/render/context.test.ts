import { assert, describe, it } from "@effect/vitest";
import type { OkfitConfig } from "@okfit/core";
import { Actor } from "@okfit/core";
import { Effect, Schema } from "effect";
import { ContextEnvelope, contextEnvelope } from "../../src/render/context.js";

const actor = Schema.decodeUnknownSync(Actor);

/** A fully specified merged config: every field `contextEnvelope` reads is present (decision 5). */
const fullConfig: OkfitConfig = {
	actors: { agent: actor("okfit/claude-code") },
	extensions: {},
	types: {
		Module: { description: "A unit of code with an owner and a boundary.", guidance: "One per package." },
		Decision: { description: "A choice made, the alternatives rejected, and why." },
	},
	tags: {
		testing: { description: "Concerns how the system is verified." },
		architecture: { description: "Concerns the shape of the system rather than one module." },
	},
};

const baseInput = {
	projectRoot: "/repo",
	bundleRoot: "/repo/okf",
	configPath: "/repo/okfit.toml",
	profile: "software-project",
	profileRequested: "software-project",
	indexPath: "/repo/okf/index.md",
	indexExists: true,
} as const;

describe("contextEnvelope", () => {
	it.effect("builds a fully specified envelope, deepStrictEqual, types/tags sorted by name", () =>
		Effect.sync(() => {
			const built = contextEnvelope({ ...baseInput, config: fullConfig });
			assert.deepStrictEqual(built, {
				schema: 1,
				project_root: "/repo",
				bundle_root: "/repo/okf",
				config_path: "/repo/okfit.toml",
				profile: "software-project",
				profile_requested: "software-project",
				index_path: "/repo/okf/index.md",
				index_exists: true,
				actors: { agent: "okfit/claude-code" },
				// K-17-style plain code-unit sort: "Decision" < "Module".
				types: [
					{ name: "Decision", description: "A choice made, the alternatives rejected, and why.", guidance: null },
					{
						name: "Module",
						description: "A unit of code with an owner and a boundary.",
						guidance: "One per package.",
					},
				],
				// "architecture" < "testing".
				tags: [
					{ name: "architecture", description: "Concerns the shape of the system rather than one module." },
					{ name: "testing", description: "Concerns how the system is verified." },
				],
			});
		}),
	);

	it.effect("types and tags sort by name regardless of insertion order", () =>
		Effect.sync(() => {
			const config: OkfitConfig = {
				extensions: {},
				types: {
					Reference: { description: "z" },
					Convention: { description: "a" },
					Interface: { description: "m" },
				},
			};
			const built = contextEnvelope({ ...baseInput, config });
			assert.deepStrictEqual(
				built.types.map((t) => t.name),
				["Convention", "Interface", "Reference"],
			);
		}),
	);

	it.effect("an absent description or guidance encodes as null, never an omitted key", () =>
		Effect.sync(() => {
			const config: OkfitConfig = { extensions: {}, types: { Project: {} } };
			const built = contextEnvelope({ ...baseInput, config });
			assert.deepStrictEqual(built.types, [{ name: "Project", description: null, guidance: null }]);
			assert.isTrue(Object.hasOwn(built.types[0] ?? {}, "description"));
			assert.isTrue(Object.hasOwn(built.types[0] ?? {}, "guidance"));
		}),
	);

	it.effect("actors.agent is null and configPath/profile are null when nothing was given", () =>
		Effect.sync(() => {
			const built = contextEnvelope({
				projectRoot: "/repo",
				bundleRoot: "/repo/okf",
				configPath: null,
				profile: null,
				profileRequested: null,
				indexPath: "/repo/okf/index.md",
				indexExists: false,
				config: { extensions: {} },
			});
			assert.isNull(built.config_path);
			assert.isNull(built.profile);
			assert.isNull(built.profile_requested);
			assert.isNull(built.actors.agent);
			assert.isFalse(built.index_exists);
		}),
	);

	it.effect("profile_requested names an unknown profile while profile stays null", () =>
		Effect.sync(() => {
			const built = contextEnvelope({
				...baseInput,
				profile: null,
				profileRequested: "not-a-real-profile",
				config: { extensions: {} },
			});
			assert.isNull(built.profile);
			assert.strictEqual(built.profile_requested, "not-a-real-profile");
		}),
	);

	it.effect("Schema.encodeSync(ContextEnvelope) round-trips through Schema.decodeUnknownSync", () =>
		Effect.sync(() => {
			const built = contextEnvelope({ ...baseInput, config: fullConfig });
			const encoded = Schema.encodeSync(ContextEnvelope)(built);
			const decoded = Schema.decodeUnknownSync(ContextEnvelope)(encoded);
			assert.deepStrictEqual(decoded, built);
		}),
	);
});
