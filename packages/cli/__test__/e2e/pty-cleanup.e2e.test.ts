// The pty helper itself. Teardown (#270): a worker killed by SIGINT or SIGTERM must not leave its
// detached cat/script/node process group behind. Failures (#457): each message says what happened.

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, assert, beforeEach, describe, it } from "@effect/vitest";
import { TSX_IMPORT } from "./utils/okfit.js";
import type { PtyOptions, PtyResult } from "./utils/pty.js";
import { limitPtyWaits, ptyAvailable, runPty } from "./utils/pty.js";

const DRIVER = resolve(import.meta.dirname, "utils", "pty-hang-driver.ts");
const TIMEOUT = 30_000;

// The helper's 30 s startup default equals TIMEOUT, so end pty waits first.
beforeEach(() => limitPtyWaits(TIMEOUT - 5_000));

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

/** Runs `node -e <script>` under the pty (the bin path after it is only an argv entry). */
const runScript = (
	script: string,
	options: Pick<PtyOptions, "steps" | "timeoutMs" | "startupTimeoutMs">,
): Promise<PtyResult> =>
	runPty([], {
		cwd: tmpdir(),
		env: { PATH: process.env.PATH ?? "" },
		nodeArgs: ["-e", script],
		...options,
	});

/** The message `run` rejects with; fails the test when it resolves. */
const failureOf = (run: Promise<PtyResult>): Promise<string> =>
	run.then(
		(result) => assert.fail(`expected a failure, got exit ${result.exitCode}: ${result.output}`),
		(error: Error) => error.message,
	);

const HANG = "setInterval(() => {}, 1000)";

describe.skipIf(!ptyAvailable)("pty helper failure messages", () => {
	it(
		"an exit before a step names the step, its text and the exit code",
		async () => {
			for (const code of [0, 3]) {
				const message = await failureOf(
					runScript(`process.exit(${code})`, { steps: [{ waitFor: "never printed", send: "x" }] }),
				);
				assert.include(message, `exited before step 1 (never printed) (exit ${code})`);
			}
		},
		TIMEOUT,
	);

	it(
		"a first step that never appears times out after startupTimeoutMs, not timeoutMs",
		async () => {
			const message = await failureOf(
				runScript(HANG, {
					steps: [{ waitFor: "never printed", send: "x" }],
					startupTimeoutMs: 500,
					timeoutMs: 20_000,
				}),
			);
			assert.include(message, "timed out waiting for never printed after 500 ms");
		},
		TIMEOUT,
	);

	it(
		"a later step times out after timeoutMs, not startupTimeoutMs",
		async () => {
			const message = await failureOf(
				runScript(`console.log("ready"); ${HANG}`, {
					steps: [
						{ waitFor: "ready", send: "x" },
						{ waitFor: "never printed", send: "x" },
					],
					startupTimeoutMs: 20_000,
					timeoutMs: 500,
				}),
			);
			assert.include(message, "timed out waiting for never printed after 500 ms");
		},
		TIMEOUT,
	);

	it(
		"a run with no steps gets startupTimeoutMs to exit",
		async () => {
			const message = await failureOf(runScript(HANG, { startupTimeoutMs: 500, timeoutMs: 20_000 }));
			assert.include(message, "timed out waiting for the process to exit after 500 ms");
		},
		TIMEOUT,
	);

	it(
		"the first step gets startupTimeoutMs, and the exit after the last step gets timeoutMs",
		async () => {
			// The text comes later than timeoutMs, then the process never exits: only the exit wait can fail.
			const message = await failureOf(
				runScript(`setTimeout(() => console.log("ready"), 2000); ${HANG}`, {
					steps: [{ waitFor: "ready", send: "x" }],
					startupTimeoutMs: 20_000,
					timeoutMs: 500,
				}),
			);
			assert.include(message, "timed out waiting for the process to exit after 500 ms");
		},
		TIMEOUT,
	);

	it(
		"the test's pty budget cuts a longer wait short and the message says so",
		async () => {
			limitPtyWaits(500);
			const start = Date.now();
			const message = await failureOf(
				runScript(HANG, { steps: [{ waitFor: "never printed", send: "x" }], startupTimeoutMs: 20_000 }),
			);
			// The run must end on the 500 ms budget, far short of the 20 s the wait asked for.
			assert.isBelow(Date.now() - start, 15_000);
			assert.match(
				message,
				/timed out waiting for never printed after \d+ ms, all that was left of the test's pty budget/,
			);
		},
		TIMEOUT,
	);
});
