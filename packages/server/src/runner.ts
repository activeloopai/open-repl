import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn as ptySpawn, type IPty } from 'node-pty';

/**
 * Terminal + command execution.
 *  - The interactive terminal is a real PTY (node-pty): prompt, echo, TUIs work.
 *  - One-shot commands (agent run_command, npm install) use child_process.
 */
export class CommandRunner {
  private shell: IPty | null = null;
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
      const p = spawn(command, { cwd: this.cwd, env, shell: true, stdio: 'pipe' }) as ChildProcessWithoutNullStreams;
      let buf = '';
      const emit = (chunk: Buffer) => {
        const s = chunk.toString();
        buf += s;
        this.onData(s);
      };
      // Stop cancels in-flight work: kill the child process group on abort so a
      // stopped turn does not leave installs/tests running in the workspace.
      const onAbort = () => {
        try {
          p.kill('SIGTERM');
        } catch {
          /* already gone */
        }
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      const done = (code: number) => {
        signal?.removeEventListener('abort', onAbort);
        this.lastOutput = buf;
        resolve(code);
      };
      p.stdout.on('data', emit);
      p.stderr.on('data', emit);
      p.on('close', (code) => done(code ?? 0));
      p.on('error', (err) => {
        this.onData(`\n[runner error] ${err.message}\n`);
        done(1);
      });
    });
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

/** Detect a localhost dev-server port from arbitrary command output. */
export function detectPort(text: string): number | null {
  const m = text.match(/localhost:(\d{2,5})|127\.0\.0\.1:(\d{2,5})|:\/\/[^\s]*:(\d{2,5})/i);
  if (!m) return null;
  const port = Number(m[1] || m[2] || m[3]);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : null;
}
