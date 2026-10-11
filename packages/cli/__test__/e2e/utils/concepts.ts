import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Writes two stable `Decision` concepts, `decisions/a` and `decisions/b`, into the sandbox bundle. Test-only. */
export const writeTwoDecisions = async (cwd: string): Promise<void> => {
	await mkdir(join(cwd, "okf", "decisions"), { recursive: true });
	for (const name of ["a", "b"]) {
		await writeFile(
			join(cwd, "okf", "decisions", `${name}.md`),
			`---\ntype: Decision\ntitle: Decision ${name}\ndescription: A decision.\nstatus: stable\n---\n\n# Decision ${name}\n`,
			"utf8",
		);
	}
	const configPath = join(cwd, ".config", "okfit.toml");
	const config = await readFile(configPath, "utf8").catch(() => "");
	if (!config.includes("types.Decision")) await writeFile(configPath, `${config}\n[types.Decision]\n`, "utf8");
};
