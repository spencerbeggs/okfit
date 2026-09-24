// Runs `vsce package` against a copy of package.json whose name is the Marketplace name.
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..");
const path = join(dir, "package.json");
const backup = join(dir, "package.json.workspace");
const pkg = JSON.parse(readFileSync(path, "utf8")) as { name: string };
copyFileSync(path, backup);
try {
	writeFileSync(path, `${JSON.stringify({ ...pkg, name: "okfit" }, null, "\t")}\n`);
	const result = spawnSync("vsce", ["package", "--no-dependencies", "--out", "okfit.vsix", ...process.argv.slice(2)], {
		cwd: dir,
		stdio: "inherit",
	});
	process.exitCode = result.status ?? 1;
} finally {
	copyFileSync(backup, path);
	rmSync(backup);
}
