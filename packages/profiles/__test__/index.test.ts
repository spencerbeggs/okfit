import { assert, describe, it } from "@effect/vitest";
import { OKF_SPEC_VERSION } from "@okfit/core";
import { Effect, Option } from "effect";
import * as Barrel from "../src/index.js";

// Contract §4's value exports, exactly (types travel with same-named values
// and add nothing to Object.keys at runtime).
const VALUES = [
	"BodyCommitted",
	"BodyProvenance",
	"BodyUncommitted",
	"AgentActorUnconfiguredError",
	"Derivation",
	"HumanActorUnresolvedError",
	"GitHistory",
	"GitHistoryError",
	"PathHistoryEntry",
	"PROFILE_NAMES",
	"ProfileDiagnostic",
	"ProfileDiagnosticCode",
	"Profiles",
	"Provenance",
] as const;

describe("@okfit/profiles", () => {
	it.effect("ships the software-project profile and resolves @okfit/core through the workspace", () =>
		Effect.sync(() => {
			assert.deepStrictEqual([...Barrel.PROFILE_NAMES], ["software-project"]);
			assert.strictEqual(OKF_SPEC_VERSION, "0.2");
		}),
	);

	it.effect("Profiles.get is some for software-project and none for everything else (P-38)", () =>
		Effect.sync(() => {
			const found = Barrel.Profiles.get("software-project");
			assert.isTrue(Option.isSome(found));
			assert.strictEqual(Option.getOrThrow(found), Barrel.Profiles.softwareProject);
			assert.strictEqual(Barrel.Profiles.softwareProject.name, "software-project");
			for (const name of ["none", "x", "", "Software-Project", "software-project "]) {
				assert.isTrue(Option.isNone(Barrel.Profiles.get(name)), `expected none for ${JSON.stringify(name)}`);
			}
		}),
	);

	it.effect("every PROFILE_NAMES entry resolves through get", () =>
		Effect.sync(() => {
			for (const name of Barrel.PROFILE_NAMES) {
				assert.isTrue(Option.isSome(Barrel.Profiles.get(name)), name);
			}
		}),
	);

	it.effect("exports exactly the contract's value surface (contract section 4)", () =>
		Effect.sync(() => {
			assert.deepStrictEqual(Object.keys(Barrel).sort(), [...VALUES].sort());
		}),
	);
});
