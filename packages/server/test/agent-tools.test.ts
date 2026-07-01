import { describe, it, expect } from 'vitest';
import { buildTools } from '../src/agent/tools.js';
import { Workspace } from '../src/workspace.js';
import { tmpWorkspace } from './helpers.js';
import type { ToolDeps } from '../src/agent/tools.js';

async function tools(overrides: Partial<ToolDeps> = {}) {
  const workspace = new Workspace(await tmpWorkspace());
  const deps: ToolDeps = {
    workspace,
    commandAllowlist: [],
    runCommand: async () => ({ code: 0, output: 'out' }),
    runApp: async () => ({ ok: true, url: 'http://localhost:3000', logs: '' }),
    ...overrides,
  };
  return { workspace, list: buildTools(deps) };
}
const byName = (list: Awaited<ReturnType<typeof tools>>['list'], n: string) => list.find((t) => t.name === n)!;

describe('buildTools (AI-SDK path)', () => {
  it('exposes the six tools', async () => {
    const { list } = await tools();
    expect(list.map((t) => t.name).sort()).toEqual(
      ['list_dir', 'read_file', 'run_app', 'run_command', 'search_repo', 'write_file'],
    );
  });
  it('write_file then read_file round-trips through the workspace', async () => {
    const { list } = await tools();
    await byName(list, 'write_file').execute({ path: 'x.txt', content: 'hi' });
    expect(await byName(list, 'read_file').execute({ path: 'x.txt' })).toMatchObject({ content: 'hi' });
  });
  it('run_command blocks a command outside the allowlist', async () => {
    const { list } = await tools({ commandAllowlist: ['npm'] });
    expect(await byName(list, 'run_command').execute({ command: 'rm -rf /' })).toMatchObject({
      error: expect.stringMatching(/blocked/i),
    });
  });
  it('run_app reports the serving url', async () => {
    const { list } = await tools();
    expect(await byName(list, 'run_app').execute({})).toMatchObject({ ok: true, url: 'http://localhost:3000' });
  });
});
