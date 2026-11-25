import { spawn, spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { Fmt } from "@effected/cli-kit";
import { BIN, TSX_IMPORT } from "./okfit.js";

/** One scripted keystroke: wait for `waitFor` to appear in new output, then write `send`. */
export interface PtyStep {
	readonly waitFor: string | RegExp;
	readonly send: string;
}

export interface PtyOptions {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly cols?: number;
	readonly rows?: number;
	readonly steps?: ReadonlyArray<PtyStep>;
	/** Extra `node` arguments placed before the bin (e.g. `--import <tracer>`). */
	readonly nodeArgs?: ReadonlyArray<string>;
	/**
	 * Timeout in ms for the first wait, measured from the spawn: step 1's text, or the exit when there
	 * are no steps. Default 30000, because it includes loading the bin.
	 */
	readonly startupTimeoutMs?: number;
	/** Timeout in ms for each later wait (steps 2 onward, then the exit), from the previous match. Default 10000. */
	readonly timeoutMs?: number;
	/** Redirect the bin's stderr to this file, leaving stdout on the pty. */
	readonly stderrFile?: string;
	/** Let the kit decide colour from the terminal, rather than pinning `FORCE_COLOR=0`. */
	readonly color?: boolean;
	/** Called with the pid (also the process-group id) right after the spawn. */
	readonly onSpawn?: (pid: number) => void;
}

export interface PtyResult {
	/** ANSI-stripped, CR-normalised terminal output. */
	readonly output: string;
	/** The terminal output exactly as received, escape sequences included. */
	readonly raw: string;
	readonly exitCode: number;
}

/** Keys for `PtyStep.send`. */
export const KEYS = { space: " ", enter: "\r", esc: "\x1b", ctrlC: "\x03", down: "\x1b[B", right: "\x1b[C" } as const;

/** `script` is the only dependency; it ships with macOS and util-linux. */
export const ptyAvailable: boolean =
	(process.platform === "darwin" || process.platform === "linux") &&
	spawnSync("which", ["script"], { stdio: "ignore" }).status === 0;

/** Strips escape sequences (the kit's `Fmt.stripAnsi`) and normalises line endings. */
export const stripAnsi = (text: string): string => Fmt.stripAnsi(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n");

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Process groups of live pty runs in this worker; `detached` cuts them off from the terminal's SIGINT. */
const liveGroups = new Set<number>();
let handlersInstalled = false;

const killAllGroups = (): void => {
	for (const pid of liveGroups) {
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
	liveGroups.clear();
};

/** Once per worker: reap live groups on exit, and on SIGINT/SIGTERM before re-raising the default. */
const installHandlers = (): void => {
	if (handlersInstalled) return;
	handlersInstalled = true;
	process.on("exit", killAllGroups);
	for (const sig of ["SIGINT", "SIGTERM"] as const) {
		process.once(sig, () => {
			killAllGroups();
			// `once` already removed this handler, so the re-raised signal terminates as the default would.
			process.kill(process.pid, sig);
		});
	}
};

const SETTLE_MS = 200;
const SENTINEL = "__PTY_EXIT__:";

/** The time past which no pty wait runs; a test file has its own copy and runs its tests one at a time. */
let budgetEnd = Number.POSITIVE_INFINITY;

/**
 * Ends every later `runPty` wait no more than `budgetMs` from now, however many runs share that time.
 * Call it in `beforeEach` with less than the test's vitest timeout, so a hang is reported by the
 * helper, with its output, and not by vitest.
 */
export const limitPtyWaits = (budgetMs: number): void => {
	budgetEnd = Date.now() + budgetMs;
};

/**
 * Runs the built bin under a real pty via the system `script`. The inner shell
 * sets the window size, runs the bin, and echoes an exit sentinel so the exit
 * code does not depend on either platform's `script` status propagation.
 *
 * A spawn error rejects as it is. Otherwise a failed run rejects with one of three messages, each
 * followed by the terminal output so far:
 * `exited before step N (text) (exit C)` when the bin ended with code C before step N matched;
 * `timed out waiting for <text, or the process to exit> after M ms` when a wait ran out and the
 * process group was killed; `no exit sentinel in pty output` when the pipeline closed without
 * reporting an exit code. A wait cut short by `limitPtyWaits` says so after its `M ms`.
 */
export const runPty = (args: ReadonlyArray<string>, options: PtyOptions): Promise<PtyResult> => {
	const cols = options.cols ?? 100;
	const rows = options.rows ?? 30;
	const timeoutMs = options.timeoutMs ?? 10_000;
	const startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
	const redirect = options.stderrFile === undefined ? "" : ` 2>${quote(options.stderrFile)}`;
	const inner = `stty cols ${cols} rows ${rows}; ${[process.execPath, ...TSX_IMPORT, ...(options.nodeArgs ?? []), BIN, ...args].map(quote).join(" ")}${redirect}; echo ${SENTINEL}$?`;
	const scriptCommand =
		process.platform === "darwin"
			? `script -q /dev/null sh -c ${quote(inner)}`
			: `script -qfec ${quote(`sh -c ${quote(inner)}`)} /dev/null`;
	// BSD `script` rejects a socket on stdin (tcgetattr: "Operation not supported on socket") and
	// Node's piped stdio is a socketpair, so `cat` re-presents our keystrokes as an anonymous pipe.
	const pipeline = `cat | ${scriptCommand}`;
	const { NO_COLOR: _noColor, FORCE_COLOR: _forceColor, ...rest } = options.env;
	const env = { ...rest, TERM: "xterm-256color", ...(options.color === true ? {} : { FORCE_COLOR: "0" }) };

	return new Promise((resolve, reject) => {
		installHandlers();
		// detached: own process group, so a kill reaches cat, script and node, not just the outer sh.
		// The group no longer gets the terminal's SIGINT; the handlers above stand in for it.
		const child = spawn("sh", ["-c", pipeline], {
			cwd: options.cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			detached: true,
		});
		if (child.pid !== undefined) {
			liveGroups.add(child.pid);
			options.onSpawn?.(child.pid);
		}
		let raw = "";
		let rawOffset = 0;
		let next = 0;
		let done = false;
		const steps = options.steps ?? [];
		let pendingUntil = 0;
		// One deadline at a time: the first wait gets startupTimeoutMs from the spawn; each later wait,
		// and the exit after the last send, gets timeoutMs from the previous match. None runs past the
		// budget `limitPtyWaits` set.
		let deadline = 0;
		let waited = "";
		const arm = (wantMs: number): void => {
			const now = Date.now();
			const left = Math.max(0, budgetEnd - now);
			deadline = now + Math.min(wantMs, left);
			waited = left < wantMs ? `${left} ms, all that was left of the test's pty budget` : `${wantMs} ms`;
		};
		arm(startupTimeoutMs);
		const sends = new Set<NodeJS.Timeout>();

		const killGroup = (): void => {
			try {
				if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
			} catch {
				// already gone
			}
		};
		const finish = (fn: () => void): void => {
			if (done) return;
			done = true;
			clearInterval(timer);
			for (const t of sends) clearTimeout(t);
			killGroup();
			if (child.pid !== undefined) liveGroups.delete(child.pid);
			child.stdin.destroy();
			fn();
		};
		const failWith = (message: string): void =>
			finish(() => reject(new Error(`${message}\n--- output so far ---\n${stripAnsi(raw)}`)));
		const advance = (): void => {
			if (done) return;
			if (next >= steps.length) {
				if (Date.now() > deadline) failWith(`timed out waiting for the process to exit after ${waited}`);
				return;
			}
			if (Date.now() < pendingUntil) return;
			const step = steps[next];
			if (step === undefined) return;
			// Strip only the unseen tail; a stripped prefix length is unstable on a partial buffer.
			const fresh = stripAnsi(raw.slice(rawOffset));
			const hit = typeof step.waitFor === "string" ? fresh.includes(step.waitFor) : step.waitFor.test(fresh);
			if (!hit) {
				if (Date.now() > deadline) failWith(`timed out waiting for ${String(step.waitFor)} after ${waited}`);
				return;
			}
			rawOffset = raw.length;
			next += 1;
			arm(timeoutMs);
			// Ink paints a screen before it attaches its key handler; a key sent in that gap is lost.
			pendingUntil = Date.now() + SETTLE_MS;
			const send = step.send;
			const t = setTimeout(() => {
				sends.delete(t);
				if (!done && child.stdin.writable) child.stdin.write(send);
			}, SETTLE_MS);
			sends.add(t);
		};

		const timer = setInterval(advance, 25);
		child.stdin.on("error", () => {
			// EPIPE after the pipeline exited or was killed is expected.
		});
		// One decoder per stream: a multibyte glyph (◉, →) split across two chunks must not become U+FFFD.
		const stdoutDecoder = new StringDecoder("utf8");
		const stderrDecoder = new StringDecoder("utf8");
		child.stdout.on("data", (chunk: Buffer) => {
			raw += stdoutDecoder.write(chunk);
			if (raw.includes(SENTINEL)) child.stdin.end();
			advance();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			raw += stderrDecoder.write(chunk);
		});
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", () => {
			finish(() => {
				const text = stripAnsi(raw);
				const match = new RegExp(`${SENTINEL}(\\d+)`).exec(text);
				if (match === null) {
					reject(new Error(`no exit sentinel in pty output\n--- output so far ---\n${text}`));
					return;
				}
				if (next < steps.length) {
					const where = `exited before step ${next + 1} (${String(steps[next]?.waitFor)}) (exit ${match[1]})`;
					reject(new Error(`${where}\n--- output so far ---\n${text}`));
					return;
				}
				resolve({ output: text.replace(new RegExp(`${SENTINEL}\\d+\\n?`), ""), raw, exitCode: Number(match[1]) });
			});
		});
	});
};
