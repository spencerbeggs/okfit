import { describe, expect, it } from "vitest";
import { statusFor } from "../src/status.js";
import type { ConceptsResult } from "../src/tree/wire.js";

const result: ConceptsResult = {
	bundles: [
		{ root: "/w/okf", rootUri: "file:///w/okf", profile: "software-project", concepts: [] },
		{ root: "/v/okf", rootUri: "file:///v/okf", profile: undefined, concepts: [] },
	],
};

describe("statusFor", () => {
	it("names the bundle and profile of the active document's root", () => {
		const s = statusFor({ documentUri: "file:///w/okf/modules/a.md", result, diagnostics: [] });
		expect(s).toEqual({ text: "OKF: okf (software-project)", detail: "/w/okf", severity: "information" });
	});

	it("omits the profile when the config sets none", () => {
		expect(statusFor({ documentUri: "file:///v/okf/x.md", result, diagnostics: [] })?.text).toBe("OKF: okf");
	});

	it("reports the worst severity among the bundle's own diagnostics only", () => {
		const s = statusFor({
			documentUri: "file:///w/okf/a.md",
			result,
			diagnostics: [
				{ uri: "file:///w/okf/b.md", severity: 1 },
				{ uri: "file:///v/okf/c.md", severity: 0 },
			],
		});
		expect(s?.severity).toBe("warning");
	});

	it("is undefined for a document outside every bundle", () => {
		expect(statusFor({ documentUri: "file:///elsewhere/readme.md", result, diagnostics: [] })).toBeUndefined();
	});

	it("matches a percent-encoded document against a percent-encoded root (I5)", () => {
		// Before the fix, `bundle.rootUri` came straight from Node's
		// `pathToFileURL` -- `file:///w/my@repo/okf`, `@` left unencoded --
		// while `documentUri` came from VS Code's own `Uri.toString()`, which
		// percent-encodes `@` as `%40`. `under()`'s plain `startsWith` never
		// matched that pair, so the status item silently never showed for a
		// bundle root containing a reserved character. The extension now
		// normalizes `rootUri` through `vscode.Uri.parse(...).toString()`
		// before calling `statusFor` (extension.ts's `updateStatus`), so by the
		// time `statusFor` sees it, `rootUri` is already percent-encoded the
		// same way `documentUri` is -- exactly what this fixture reproduces.
		const encoded: ConceptsResult = {
			bundles: [{ root: "/w/my@repo/okf", rootUri: "file:///w/my%40repo/okf", profile: undefined, concepts: [] }],
		};
		const s = statusFor({ documentUri: "file:///w/my%40repo/okf/a.md", result: encoded, diagnostics: [] });
		expect(s?.detail).toBe("/w/my@repo/okf");
	});
});
