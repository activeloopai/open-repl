import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn as ptySpawn, type IPty } from 'node-pty';

/**
 * Terminal + command execution.
 *  - The interactive terminal is a real PTY (node-pty): prompt, echo, TUIs work.
 *  - One-shot commands (agent run_command, npm install) use child_process.
 */
export class CommandRunner {
  private shell: IPty | null = null;
  /** Live one-shot children so Stop can kill them even without a per-call signal. */
  private active = new Set<ChildProcessWithoutNullStreams>();
  lastOutput = '';

  constructor(
    private cwd: string,
    private env: () => Promise<Record<string, string>>,
    private onData: (data: string) => void,
    private onExit: (code: number) => void,
  ) {}

  /** Start a real interactive shell for the terminal pane. */
  async startShell(cols = 80, rows = 24): Promise<void> {
    const env = { ...process.env, ...(await this.env()) } as { [k: string]: string };
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    this.shell = ptySpawn(shell, [], { name: 'xterm-color', cols, rows, cwd: this.cwd, env });
    this.shell.onData((d) => this.onData(d));
    this.shell.onExit(({ exitCode }) => this.onExit(exitCode));
  }

  input(data: string): void {
    this.shell?.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.shell?.resize(cols, rows);
    } catch {
      /* shell gone */
    }
  }

  /** Run a one-shot command, streaming output. Resolves with exit code. */
  async run(command: string, signal?: AbortSignal): Promise<number> {
    const env = { ...process.env, ...(await this.env()) };
    return new Promise((resolve) => {
      // detached: true makes the child a process-group leader so we can signal
      // the WHOLE tree on abort — `shell: true` spawns a subshell, and killing
      // only the shell leaves the real command (npm/pip/dev server) running.
      const p = spawn(command, { cwd: this.cwd, env, shell: true, stdio: 'pipe', detached: true }) as ChildProcessWithoutNullStreams;
      this.active.add(p);
      let buf = '';
      const emit = (chunk: Buffer) => {
        const s = chunk.toString();
        buf += s;
        this.onData(s);
      };
      // Stop cancels in-flight work: kill the child process group on abort so a
      // stopped turn does not leave installs/tests running in the workspace.
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        killGroup(p);
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      const done = (code: number) => {
        signal?.removeEventListener('abort', onAbort);
        this.active.delete(p);
        this.lastOutput = buf;
        resolve(code);
      };
      p.stdout.on('data', emit);
      p.stderr.on('data', emit);
      // On a signal kill, `close` reports code=null — never map that to 0, or a
      // cancelled command would look like it succeeded. Report non-zero
      // (130 = terminated) so callers see the run did not complete.
      p.on('close', (code) => done(code ?? (aborted ? 130 : 1)));
      p.on('error', (err) => {
        this.onData(`\n[runner error] ${err.message}\n`);
        done(1);
      });
    });
  }

  /**
   * Kill every in-flight one-shot command (whole process group each). Used by
   * Stop so a dev server started by the agent or typed in the terminal — not
   * just a Run-button workflow — actually stops.
   */
  stopRuns(): void {
    for (const p of this.active) killGroup(p);
    this.active.clear();
  }

  kill(): void {
    try {
      this.shell?.kill();
    } catch {
      /* already gone */
    }
    this.shell = null;
  }
}

/** Kill a detached child and its whole process group (SIGTERM), best-effort. */
function killGroup(p: ChildProcessWithoutNullStreams): void {
  try {
    if (p.pid) process.kill(-p.pid, 'SIGTERM'); // negative pid = the group
    else p.kill('SIGTERM');
  } catch {
    try {
      p.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

/** Detect a localhost dev-server port from arbitrary command output. */
export function detectPort(text: string): number | null {
  const m = text.match(/localhost:(\d{2,5})|127\.0\.0\.1:(\d{2,5})|:\/\/[^\s]*:(\d{2,5})/i);
  if (!m) return null;
  const port = Number(m[1] || m[2] || m[3]);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : null;
}
