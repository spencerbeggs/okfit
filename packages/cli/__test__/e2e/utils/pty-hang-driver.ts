// Driver for pty-cleanup.e2e.test.ts: starts a pty run that never finishes and prints its group id.
import { tmpdir } from "node:os";
import { runPty } from "./pty.js";

runPty([], {
	cwd: tmpdir(),
	env: { PATH: process.env.PATH ?? "" },
	// `-e` keeps node alive forever; the bin path after it is only an argv entry.
	nodeArgs: ["-e", "setInterval(() => {}, 1000)"],
	steps: [{ waitFor: "text that never appears", send: "x" }],
	timeoutMs: 120_000,
	onSpawn: (pid) => console.log(`PGID:${pid}`),
}).catch(() => {
	// unreachable in the test: the driver is killed first
});
