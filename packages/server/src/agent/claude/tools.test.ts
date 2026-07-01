import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Workspace } from '../../workspace.js';
import { openReplToolHandlers } from './tools.js';
import type { ToolDeps } from '../tools.js';

/** Parse the JSON payload out of an MCP CallToolResult. */
function payload(r: { content: { text: string }[] }): any {
  return JSON.parse(r.content[0].text);
}

async function setup(overrides: Partial<ToolDeps> = {}) {
  const dir = path.join(os.tmpdir(), 'openrepl-tools-' + randomUUID());
  await fs.mkdir(dir, { recursive: true });
  const workspace = new Workspace(dir);
  const deps: ToolDeps = {
    workspace,
    commandAllowlist: [],
    runCommand: async () => ({ code: 0, output: 'ran' }),
    runApp: async () => ({ ok: true, url: 'http://localhost:5000', logs: '' }),
    ...overrides,
  };
  return { dir, workspace, h: openReplToolHandlers(deps) };
}

describe('openReplToolHandlers', () => {
  it('write_file persists to the workspace; read_file reads it back', async () => {
    const { dir, h } = await setup();
    const w = payload(await h.write_file({ path: 'a.txt', content: 'hello' }));
    expect(w).toEqual({ ok: true, path: 'a.txt' });
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('hello');
    expect(payload(await h.read_file({ path: 'a.txt' })).content).toBe('hello');
  });

  it('list_dir lists entries; search_repo finds a substring', async () => {
    const { h } = await setup();
    await h.write_file({ path: 'note.md', content: 'find-me-token' });
    expect(payload(await h.list_dir({})).entries.length).toBeGreaterThan(0);
    const matches = payload(await h.search_repo({ query: 'find-me-token' })).matches;
    expect(JSON.stringify(matches)).toContain('note.md');
  });

  it('run_command returns exit code + output when allowed', async () => {
    const { h } = await setup();
    expect(payload(await h.run_command({ command: 'anything' }))).toEqual({ exitCode: 0, output: 'ran' });
  });

  it('run_command is blocked by a non-matching allowlist', async () => {
    const { h } = await setup({ commandAllowlist: ['npm'] });
    const r = payload(await h.run_command({ command: 'rm -rf /' }));
    expect(r.error).toMatch(/blocked by allowlist/i);
  });

  it('run_app maps a serving app to ok:true+url and a failure to ok:false+error', async () => {
    const okSetup = await setup();
    expect(payload(await okSetup.h.run_app()).ok).toBe(true);
    const bad = await setup({ runApp: async () => ({ ok: false, logs: 'traceback...' }) });
    const r = payload(await bad.h.run_app());
    expect(r).toMatchObject({ ok: false, error: 'traceback...' });
  });
});

import { buildOpenReplMcpServer, MCP_SERVER_NAME, mcpToolName } from './tools.js';

describe('buildOpenReplMcpServer', () => {
  it('builds an in-process MCP server named openrepl and namespaces tool names', async () => {
    const s = await setup();
    const server = buildOpenReplMcpServer({
      workspace: s.workspace,
      commandAllowlist: [],
      runCommand: async () => ({ code: 0, output: '' }),
      runApp: async () => ({ ok: true, logs: '' }),
    });
    expect(server).toBeTruthy();
    expect(MCP_SERVER_NAME).toBe('openrepl');
    expect(mcpToolName('run_app')).toBe('mcp__openrepl__run_app');
  });
});
