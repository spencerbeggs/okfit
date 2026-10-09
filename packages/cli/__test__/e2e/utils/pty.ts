import { spawn, spawnSync } from "node:child_process";
import { BIN } from "./okfit.js";

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
	/** Per-wait and overall timeout in ms. Default 20000. */
	readonly timeoutMs?: number;
}

export interface PtyResult {
	/** ANSI-stripped, CR-normalised terminal output. */
	readonly output: string;
	readonly exitCode: number;
}

/** Keys for `PtyStep.send`. */
export const KEYS = { space: " ", enter: "\r", esc: "\x1b", ctrlC: "\x03", down: "\x1b[B" } as const;

/** `script` is the only dependency; it ships with macOS and util-linux. */
export const ptyAvailable: boolean =
	(process.platform === "darwin" || process.platform === "linux") &&
	spawnSync("which", ["script"], { stdio: "ignore" }).status === 0;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;

/** Strips escape sequences and normalises line endings. */
export const stripAnsi = (text: string): string =>
	text.replace(ANSI, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const SETTLE_MS = 200;
const SENTINEL = "__PTY_EXIT__:";

/**
 * Runs the built bin under a real pty via the system `script`. The inner shell
 * sets the window size, runs the bin, and echoes an exit sentinel so the exit
 * code does not depend on either platform's `script` status propagation.
 */
export const runPty = (args: ReadonlyArray<string>, options: PtyOptions): Promise<PtyResult> => {
	const cols = options.cols ?? 100;
	const rows = options.rows ?? 30;
	const timeoutMs = options.timeoutMs ?? 10_000;
	const inner = `stty cols ${cols} rows ${rows}; ${[process.execPath, ...(options.nodeArgs ?? []), BIN, ...args].map(quote).join(" ")}; echo ${SENTINEL}$?`;
	const scriptCommand =
		process.platform === "darwin"
			? `script -q /dev/null sh -c ${quote(inner)}`
			: `script -qfec ${quote(`sh -c ${quote(inner)}`)} /dev/null`;
	// BSD `script` rejects a socket on stdin (tcgetattr: "Operation not supported on socket") and
	// Node's piped stdio is a socketpair, so `cat` re-presents our keystrokes as an anonymous pipe.
	const pipeline = `cat | ${scriptCommand}`;
	const { NO_COLOR: _noColor, ...rest } = options.env;
	const env = { ...rest, TERM: "xterm-256color", FORCE_COLOR: "0" };

	return new Promise((resolve, reject) => {
		// detached: own process group, so a kill reaches cat, script and node, not just the outer sh.
		const child = spawn("sh", ["-c", pipeline], {
			cwd: options.cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			detached: true,
		});
		let raw = "";
		let rawOffset = 0;
		let next = 0;
		let done = false;
		const steps = options.steps ?? [];
		let pendingUntil = 0;
		// One deadline: each wait gets timeoutMs, and so does the exit after the last send.
		let deadline = Date.now() + timeoutMs;
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
			child.stdin.destroy();
			fn();
		};
		const failWith = (message: string): void =>
			finish(() => reject(new Error(`${message}\n--- output so far ---\n${stripAnsi(raw)}`)));
		const advance = (): void => {
			if (done) return;
			if (next >= steps.length) {
				if (Date.now() > deadline) failWith("timed out waiting for the process to exit");
				return;
			}
			if (Date.now() < pendingUntil) return;
			const step = steps[next];
			if (step === undefined) return;
			// Strip only the unseen tail; a stripped prefix length is unstable on a partial buffer.
			const fresh = stripAnsi(raw.slice(rawOffset));
			const hit = typeof step.waitFor === "string" ? fresh.includes(step.waitFor) : step.waitFor.test(fresh);
			if (!hit) {
				if (Date.now() > deadline) failWith(`timed out waiting for ${String(step.waitFor)}`);
				return;
			}
			rawOffset = raw.length;
			next += 1;
			deadline = Date.now() + timeoutMs;
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
		child.stdout.on("data", (chunk: Buffer) => {
			raw += chunk.toString("utf8");
			if (raw.includes(SENTINEL)) child.stdin.end();
			advance();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			raw += chunk.toString("utf8");
		});
		child.on("error", (error) => finish(() => reject(error)));
		child.on("close", () => {
			finish(() => {
				const text = stripAnsi(raw);
				const match = new RegExp(`${SENTINEL}(\\d+)`).exec(text);
				if (match === null) {
					reject(new Error(`no exit sentinel in pty output\n${text}`));
					return;
				}
				if (next < steps.length) {
					reject(new Error(`exited before step ${next + 1} (${String(steps[next]?.waitFor)})\n${text}`));
					return;
				}
				resolve({ output: text.replace(new RegExp(`${SENTINEL}\\d+\\n?`), ""), exitCode: Number(match[1]) });
			});
		});
	});
};
