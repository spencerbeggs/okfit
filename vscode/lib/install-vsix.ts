// Uninstalls, then installs, the packaged okfit.vsix via the `code` CLI, so a
// local build can be reloaded into VS Code without any manual steps.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..");
const vsix = join(dir, "okfit.vsix");
const extensionId = "okfit.okfit";
const code = process.env.VSCODE_CLI ?? "code";

if (!existsSync(vsix)) {
	console.error(`install-vsix: ${vsix} does not exist -- run pnpm vscode:package first`);
	process.exit(1);
}

function lastStderrLine(stderr: string): string {
	const lines = stderr.trim().split("\n");
	return lines.at(-1) ?? "";
}

const uninstall = spawnSync(code, ["--uninstall-extension", extensionId], { encoding: "utf8", shell: false });
if (uninstall.error) {
	console.error(`install-vsix: could not run "${code}" -- is it on PATH? (${uninstall.error.message})`);
	process.exit(1);
}
if (uninstall.status !== 0) {
	console.log(`install-vsix: uninstall skipped -- ${lastStderrLine(uninstall.stderr)}`);
}

const install = spawnSync(code, ["--install-extension", vsix, "--force"], { encoding: "utf8", shell: false });
if (install.error) {
	console.error(`install-vsix: could not run "${code}" -- is it on PATH? (${install.error.message})`);
	process.exit(1);
}
if (install.status !== 0) {
	console.error(`install-vsix: install failed -- ${install.stderr}`);
	process.exit(install.status ?? 1);
}

const list = spawnSync(code, ["--list-extensions", "--show-versions"], { encoding: "utf8", shell: false });
const installedLine = list.stdout.split("\n").find((line) => line.startsWith(`${extensionId}@`));
if (installedLine) {
	console.log(installedLine);
} else {
	console.log(`install-vsix: installed, but no "${extensionId}@" line found in --list-extensions output`);
}

console.log("Reload the VS Code window to load the new build.");
