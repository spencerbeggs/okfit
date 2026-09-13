import { assert, describe, it } from "@effect/vitest";
import type { OkfitConfig } from "@okfit/core";
import { Actor } from "@okfit/core";
import { contextEnvelope } from "@okfit/engine";
import { Effect, Schema } from "effect";
import { humanContext } from "../../src/render/context.js";

const actor = Schema.decodeUnknownSync(Actor);

/** A fully specified merged config: every field `contextEnvelope` reads is present (decision 5). */
const fullConfig: OkfitConfig = {
	actors: { agent: actor("okfit/claude-code") },
	extensions: {},
	types: {
		Module: {
			description: "A unit of code with an owner and a boundary.",
			guidance: "One per package.",
			required: ["resource", "kind"],
			fields: {
				resource: { description: "Where the code lives.", kind: "path" },
				kind: { description: "What sort of unit.", values: { website: "A site.", package: "An npm package." } },
				layer: { description: "Free text." },
			},
		},
		Decision: { description: "A choice made, the alternatives rejected, and why.", require_verified: true },
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

describe("humanContext", () => {
	it.effect('renders "(none)" for a null config_path and profile, "(unset)" for a null agent', () =>
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
			const lines = humanContext(built);
			assert.isTrue(lines.includes("config: (none)"));
			assert.isTrue(lines.includes("profile: (none)"));
			assert.isTrue(lines.includes("agent: (unset)"));
			assert.isTrue(lines.includes("index.md: /repo/okf/index.md (missing)"));
		}),
	);

	it.effect("profile: (none) (requested <name>, unknown) when profile is unknown", () =>
		Effect.sync(() => {
			const built = contextEnvelope({
				projectRoot: "/repo",
				bundleRoot: "/repo/okf",
				configPath: "/repo/okfit.toml",
				profile: null,
				profileRequested: "not-a-real-profile",
				indexPath: "/repo/okf/index.md",
				indexExists: false,
				config: { extensions: {} },
			});
			const lines = humanContext(built);
			assert.isTrue(lines.includes("profile: (none) (requested not-a-real-profile, unknown)"));
		}),
	);

	it.effect('renders "profile: (none)" (no unknown suffix) when profile_requested is null or "none"', () =>
		Effect.sync(() => {
			const noConfig = contextEnvelope({
				projectRoot: "/repo",
				bundleRoot: "/repo/okf",
				configPath: null,
				profile: null,
				profileRequested: null,
				indexPath: "/repo/okf/index.md",
				indexExists: false,
				config: { extensions: {} },
			});
			assert.isTrue(humanContext(noConfig).includes("profile: (none)"));

			const noneProfile = contextEnvelope({
				projectRoot: "/repo",
				bundleRoot: "/repo/okf",
				configPath: "/repo/okfit.toml",
				profile: null,
				profileRequested: "none",
				indexPath: "/repo/okf/index.md",
				indexExists: false,
				config: { extensions: {} },
			});
			assert.isTrue(humanContext(noneProfile).includes("profile: (none)"));
		}),
	);

	it.effect("renders one bullet per type and per tag, in the envelope's already-sorted order", () =>
		Effect.sync(() => {
			const built = contextEnvelope({ ...baseInput, config: fullConfig });
			const lines = humanContext(built);
			assert.isTrue(lines.includes("  Decision  A choice made, the alternatives rejected, and why."));
			assert.isTrue(lines.includes("  Module  A unit of code with an owner and a boundary."));
			assert.isTrue(lines.includes("  architecture  Concerns the shape of the system rather than one module."));
			assert.isTrue(lines.includes("  testing  Concerns how the system is verified."));
			assert.isTrue(lines.includes("index.md: /repo/okf/index.md (exists)"));
			assert.isTrue(lines.includes("agent: okfit/claude-code"));
		}),
	);

	it.effect("renders each type's constraints under its bullet, and nothing under a type with none (issue #33)", () =>
		Effect.sync(() => {
			const built = contextEnvelope({ ...baseInput, config: fullConfig });
			const lines = humanContext(built);
			const decision = lines.indexOf("  Decision  A choice made, the alternatives rejected, and why.");
			const module = lines.indexOf("  Module  A unit of code with an owner and a boundary.");
			assert.deepStrictEqual(lines.slice(decision + 1, module), ["    verified: required"]);
			assert.deepStrictEqual(lines.slice(module + 1, module + 3), [
				"    required: resource, kind",
				"    fields: kind (website | package), layer, resource (path)",
			]);
			assert.strictEqual(lines[module + 3], "");
		}),
	);
});
