// pty teardown (#270): a worker killed by SIGINT or SIGTERM must not leave its detached
// cat/script/node process group behind.

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { TSX_IMPORT } from "./utils/okfit.js";
import { ptyAvailable } from "./utils/pty.js";

const DRIVER = resolve(import.meta.dirname, "utils", "pty-hang-driver.ts");
const TIMEOUT = 30_000;

const groupAlive = (pgid: number): boolean => {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		return false;
	}
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Starts the driver and resolves once it has printed its group id. */
const startDriver = (): Promise<{ child: ChildProcess; pgid: number }> =>
	new Promise((resolveStart, reject) => {
		const child = spawn(process.execPath, [...TSX_IMPORT, DRIVER], { stdio: ["ignore", "pipe", "inherit"] });
		let out = "";
		child.once("error", reject);
		child.once("exit", () => reject(new Error(`driver exited before printing a pgid: ${out}`)));
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString();
			const match = /PGID:(\d+)/.exec(out);
			if (match !== null) resolveStart({ child, pgid: Number(match[1]) });
		});
	});

describe.skipIf(!ptyAvailable)("pty helper teardown", () => {
	let pgid: number | undefined;
	let driver: ChildProcess | undefined;

	afterEach(() => {
		if (pgid !== undefined) {
			try {
				process.kill(-pgid, "SIGKILL");
			} catch {
				// already gone
			}
		}
		driver?.kill("SIGKILL");
		pgid = undefined;
		driver = undefined;
	});

	for (const sig of ["SIGINT", "SIGTERM"] as const) {
		it(
			`reaps the process group and still dies from ${sig}`,
			async () => {
				const started = await startDriver();
				driver = started.child;
				pgid = started.pgid;
				assert.isTrue(groupAlive(pgid));
				// Freeze the group so the pipeline cannot collapse on its own when the driver dies
				// (a stopped `cat` never sees EOF); only an explicit SIGKILL from the driver's handlers reaps it.
				process.kill(-pgid, "SIGSTOP");

				const exited = new Promise<NodeJS.Signals | null>((res) => {
					started.child.once("exit", (_code, signal) => res(signal));
				});
				started.child.kill(sig);
				assert.strictEqual(await exited, sig);

				const deadline = Date.now() + 2_000;
				while (groupAlive(pgid) && Date.now() < deadline) await sleep(50);
				assert.isFalse(groupAlive(pgid));
			},
			TIMEOUT,
		);
	}
});
