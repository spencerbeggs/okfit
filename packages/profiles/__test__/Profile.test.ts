import { assert, describe, it } from "@effect/vitest";
import { Diagnostic, DiagnosticRange } from "@okfit/core";
import { Effect, Schema } from "effect";
import type { ProfileName } from "../src/Profile.js";
import { PROFILE_NAMES, ProfileDiagnostic, ProfileDiagnosticCode } from "../src/Profile.js";

const decodeCode = Schema.decodeUnknownSync(ProfileDiagnosticCode);
const decodeDiagnostic = Schema.decodeUnknownSync(ProfileDiagnostic);

/** The renderer shape contract section 2 promises the CLI: both families assign to it. */
interface Renderable {
	readonly file: string;
	readonly code: string;
	readonly severity: "error" | "warning" | "info";
	readonly message: string;
	readonly range?: DiagnosticRange;
}
const render = (d: Renderable): string => `${d.severity} ${d.code} ${d.file}: ${d.message}`;

describe("Profile", () => {
	it.effect("PROFILE_NAMES is exactly [software-project] and ProfileName is its member type", () =>
		Effect.sync(() => {
			assert.deepStrictEqual([...PROFILE_NAMES], ["software-project"]);
			const name: ProfileName = "software-project";
			assert.strictEqual(name, PROFILE_NAMES[0]);
		}),
	);

	it.effect("ProfileDiagnosticCode admits the three P-21 codes and nothing from core's LintCode", () =>
		Effect.sync(() => {
			for (const code of ["project-missing", "project-multiple", "project-not-at-root"]) {
				assert.strictEqual(decodeCode(code), code);
			}
			for (const bad of ["broken-links", "required-key-missing", "project-none", "", 1, null]) {
				assert.throws(() => decodeCode(bad), undefined, undefined, `expected ${JSON.stringify(bad)} to fail`);
			}
		}),
	);

	it.effect("ProfileDiagnostic decodes core's Diagnostic field set with a profile code; range is optional", () =>
		Effect.sync(() => {
			const bare = decodeDiagnostic({ file: "", code: "project-missing", severity: "error", message: "m" });
			assert.deepStrictEqual(bare, { file: "", code: "project-missing", severity: "error", message: "m" });
			assert.isFalse("range" in bare);
			const ranged = decodeDiagnostic({
				file: "sub/project.md",
				code: "project-not-at-root",
				severity: "error",
				message: "m",
				range: { offset: 0, length: 3, line: 0, character: 0 },
			});
			assert.instanceOf(ranged.range, DiagnosticRange);
			for (const bad of [
				{ file: "", code: "broken-links", severity: "error", message: "m" },
				{ file: "", code: "project-missing", severity: "fatal", message: "m" },
				{ code: "project-missing", severity: "error", message: "m" },
			]) {
				assert.throws(() => decodeDiagnostic(bad));
			}
		}),
	);

	it.effect("both diagnostic families assign to the one renderer shape (contract section 2)", () =>
		Effect.sync(() => {
			const profile: ProfileDiagnostic = { file: "", code: "project-missing", severity: "error", message: "none" };
			const core = Diagnostic.make({ file: "a.md", code: "broken-links", severity: "warning", message: "dangling" });
			assert.strictEqual(render(profile), "error project-missing : none");
			assert.strictEqual(render(core), "warning broken-links a.md: dangling");
		}),
	);
});
