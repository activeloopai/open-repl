import { describe, it, expect } from 'vitest';
import { detectPort } from '../src/runner.js';
import { BudgetGuard } from '../src/agent/guards.js';
import { buildTools } from '../src/agent/tools.js';
import { Workspace } from '../src/workspace.js';
import { tmpWorkspace } from './helpers.js';

describe('detectPort', () => {
  it('finds common dev-server port formats', () => {
    expect(detectPort('Local: http://localhost:5173/')).toBe(5173);
    expect(detectPort('listening on 127.0.0.1:3000')).toBe(3000);
    expect(detectPort('no port here')).toBeNull();
  });
});

describe('BudgetGuard', () => {
  it('flags when the token ceiling is exceeded', () => {
    const g = new BudgetGuard(100);
    g.add(40, 40);
    expect(g.exceeded).toBe(false);
    expect(g.remaining()).toBe(20);
    g.add(10, 20);
    expect(g.exceeded).toBe(true);
  });
});

describe('agent tools', () => {
  it('write_file then read_file round-trips through the workspace', async () => {
    const ws = new Workspace(await tmpWorkspace());
    const tools = buildTools({ workspace: ws, runCommand: async () => ({ code: 0, output: '' }), commandAllowlist: [] });
    const write = tools.find((t) => t.name === 'write_file')!;
    const read = tools.find((t) => t.name === 'read_file')!;
    await write.execute({ path: 'x.js', content: 'console.log(1)' });
    expect(await read.execute({ path: 'x.js' })).toMatchObject({ content: 'console.log(1)' });
  });

  it('run_command respects the allowlist', async () => {
    const ws = new Workspace(await tmpWorkspace());
    let ran = false;
    const tools = buildTools({
      workspace: ws,
      runCommand: async () => {
        ran = true;
        return { code: 0, output: 'ok' };
      },
      commandAllowlist: ['npm'],
    });
    const run = tools.find((t) => t.name === 'run_command')!;
    const blocked = await run.execute({ command: 'rm -rf /' });
    expect(blocked).toMatchObject({ error: expect.stringContaining('blocked') });
    expect(ran).toBe(false);
    await run.execute({ command: 'npm test' });
    expect(ran).toBe(true);
  });
});
