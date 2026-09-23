import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const vscodeRoot = join(import.meta.dirname, "..");
const repoRoot = join(vscodeRoot, "..");
const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
	scripts: Record<string, string>;
};

describe("root vscode:package / vscode:install scripts", () => {
	it("defines vscode:package building the lsp then this extension's dist and .vsix", () => {
		const script = rootManifest.scripts["vscode:package"];
		expect(script).toBeDefined();
		expect(script).toContain("--filter=@okfit/lsp");
		expect(script).toContain("--filter @okfit/vscode-extension build");
		expect(script).toContain("--filter @okfit/vscode-extension package");
	});

	it("defines vscode:install running vscode:package then install-vsix.ts", () => {
		const script = rootManifest.scripts["vscode:install"];
		expect(script).toBeDefined();
		expect(script).toContain("pnpm vscode:package");
		expect(script).toContain("vscode/lib/install-vsix.ts");
	});
});

describe("vscode/lib/install-vsix.ts", () => {
	const scriptPath = join(vscodeRoot, "lib", "install-vsix.ts");

	it("exists", () => {
		expect(existsSync(scriptPath)).toBe(true);
	});

	it("uninstalls and installs okfit.okfit via the code CLI", () => {
		const source = readFileSync(scriptPath, "utf8");
		expect(source).toContain("--uninstall-extension");
		expect(source).toContain("okfit.okfit");
		expect(source).toContain("--install-extension");
	});
});
