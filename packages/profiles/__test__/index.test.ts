import { assert, describe, it } from "@effect/vitest";
import { OKF_SPEC_VERSION } from "@okfit/core";
import { Effect, Option } from "effect";
import { PROFILE_NAMES, Profiles } from "../src/index.js";

describe("@okfit/profiles", () => {
	it.effect("ships the software-project profile and resolves @okfit/core through the workspace", () =>
		Effect.sync(() => {
			assert.deepStrictEqual([...PROFILE_NAMES], ["software-project"]);
			assert.strictEqual(OKF_SPEC_VERSION, "0.2");
		}),
	);

	it.effect("Profiles.get is some for software-project and none for everything else (P-38)", () =>
		Effect.sync(() => {
			const found = Profiles.get("software-project");
			assert.isTrue(Option.isSome(found));
			assert.strictEqual(Option.getOrThrow(found), Profiles.softwareProject);
			assert.strictEqual(Profiles.softwareProject.name, "software-project");
			for (const name of ["none", "x", "", "Software-Project", "software-project "]) {
				assert.isTrue(Option.isNone(Profiles.get(name)), `expected none for ${JSON.stringify(name)}`);
			}
		}),
	);

	it.effect("every PROFILE_NAMES entry resolves through get", () =>
		Effect.sync(() => {
			for (const name of PROFILE_NAMES) {
				assert.isTrue(Option.isSome(Profiles.get(name)), name);
			}
		}),
	);
});
