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

	it("spells every field as x-okfit- plus its name, with _ written as -", () => {
		for (const name of PROFILE_FIELD_NAMES)
			assert.strictEqual(ProfileKeys[name], `x-okfit-${name.replaceAll("_", "-")}`);
		assert.strictEqual(ProfileKeys.kind, "x-okfit-kind");
		assert.strictEqual(ProfileKeys.links_to, "x-okfit-links-to");
		// The declared type is the literal spelling too: these assignments fail to compile if it widens or disagrees.
		const kebab: "x-okfit-links-to" = ProfileKeys.links_to;
		const plain: "x-okfit-kind" = ProfileKeys.kind;
		assert.deepStrictEqual([kebab, plain], ["x-okfit-links-to", "x-okfit-kind"]);
	});

	it("keeps resource, an OKF key the profile re-declares, out of the table", () => {
		assert.isFalse((Object.values(ProfileKeys) as ReadonlyArray<string>).includes("resource"));
		assert.isFalse("resource" in ProfileKeys);
	});

	it("names the keys the Module type requires", () => {
		assert.deepStrictEqual(Profiles.softwareProject.config.types?.Module?.required, ["resource", "x-okfit-kind"]);
	});

	it("covers exactly the fields the software-project profile declares, plus resource", () => {
		const declared = new Set<string>();
		for (const type of Object.values(Profiles.softwareProject.config.types ?? {})) {
			for (const key of Object.keys(type.fields ?? {})) declared.add(key);
		}
		assert.deepStrictEqual(
			[...declared].sort(),
			[...PROFILE_FIELD_NAMES.map((name) => ProfileKeys[name]), "resource"].sort(),
		);
	});
});
