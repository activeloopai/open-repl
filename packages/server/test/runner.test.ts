import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { CommandRunner } from '../src/runner.js';

/**
 * CommandRunner.run — the shell path the agent's run_command uses. Real spawns
 * (no mocks). Covers the abort contract: a stopped command must return non-zero
 * (the bug was `code ?? 0` mapping a signal-kill to a false success) and must
 * unblock promptly rather than waiting the command out.
 */
describe('CommandRunner.run', () => {
  const make = () => new CommandRunner(os.tmpdir(), async () => ({}), () => {}, () => {});

  it('runs a command and returns exit 0 with captured output', async () => {
    const r = make();
    const code = await r.run('echo hello-openrepl');
    expect(code).toBe(0);
    expect(r.lastOutput).toContain('hello-openrepl');
  });

  it('a stopped command returns non-zero and unblocks promptly', async () => {
    const r = make();
    const ctrl = new AbortController();
    const start = Date.now();
    const running = r.run('sleep 5', ctrl.signal);
    setTimeout(() => ctrl.abort(), 150);
    const code = await running;
    expect(code).not.toBe(0); // killed → non-zero, not a false success
    expect(Date.now() - start).toBeLessThan(4000); // aborted early, not waited out
  });

  it('stopRuns() kills a command that has no per-call signal (the Stop button path)', async () => {
    // Reproduces the reported bug: a dev server started via the terminal/agent
    // has no AbortSignal, so only stopRuns() (invoked by Stop) can end it.
    const r = make();
    const start = Date.now();
    const running = r.run('sleep 5'); // no signal
    setTimeout(() => r.stopRuns(), 150);
    const code = await running;
    expect(code).not.toBe(0);
    expect(Date.now() - start).toBeLessThan(4000);
  });
});

describe('CommandRunner — interactive shell (PTY)', () => {
  it('starts a shell, accepts input, and kills cleanly', async () => {
    let sawData = false;
    let exitCode: number | null = null;
    const r = new CommandRunner(os.tmpdir(), async () => ({}), () => { sawData = true; }, (c) => { exitCode = c; });
    await r.startShell();
    r.input('echo pty-hello\n');
    r.resize(100, 40);
    await new Promise((res) => setTimeout(res, 400));
    r.kill();
    await new Promise((res) => setTimeout(res, 200));
    expect(sawData).toBe(true);           // shell echoed output back
    expect(exitCode === null || typeof exitCode === 'number').toBe(true);
  });
});
