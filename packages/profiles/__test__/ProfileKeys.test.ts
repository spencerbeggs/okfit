import { assert, describe, it } from "@effect/vitest";
import { PROFILE_FIELD_NAMES, ProfileKeys } from "../src/ProfileKeys.js";
import { Profiles } from "../src/Profiles.js";

describe("ProfileKeys", () => {
	it("lists the 18 built-in field names in declaration order", () => {
		assert.deepStrictEqual(
			[...PROFILE_FIELD_NAMES],
			[
				"kind",
				"layer",
				"pins",
				"supersedes",
				"bounds",
				"repository",
				"gate",
				"justifies",
				"occurred",
				"guard",
				"audience",
				"url",
				"links_to",
				"surface",
				"renders",
				"entry",
				"crosses",
				"runbooks",
			],
		);
	});

	it("spells every field as its own name today", () => {
		for (const name of PROFILE_FIELD_NAMES) assert.strictEqual(ProfileKeys[name], name);
	});

	it("covers exactly the fields the software-project profile declares, plus resource", () => {
		const declared = new Set<string>();
		for (const type of Object.values(Profiles.softwareProject.config.types ?? {})) {
			for (const key of Object.keys(type.fields ?? {})) declared.add(key);
		}
		assert.deepStrictEqual([...declared].sort(), [...PROFILE_FIELD_NAMES, "resource"].sort());
	});
});
