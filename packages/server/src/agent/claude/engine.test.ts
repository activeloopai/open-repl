import { describe, it, expect } from 'vitest';
import { makeCanUseTool } from './engine.js';

/**
 * Tests for the permission gate (canUseTool). These catch real bugs the e2e
 * surfaced: a stuck read-only loop that burned the turn budget, and the command
 * allowlist (bypass + gating). canUseTool ignores its 3rd arg, so we pass {}.
 */
const ctx = {} as never;

describe('canUseTool — permission + allowlist', () => {
  it('denies a tool that is not on the permitted list', async () => {
    const gate = makeCanUseTool([]);
    const r = await gate('mcp__openrepl__rm_rf', {}, ctx);
    expect(r.behavior).toBe('deny');
  });

  it('allows permitted built-ins and MCP tools (empty allowlist = allow-all commands)', async () => {
    const gate = makeCanUseTool([]);
    expect((await gate('Read', { file_path: 'a' }, ctx)).behavior).toBe('allow');
    expect((await gate('mcp__openrepl__run_command', { command: 'rm -rf /' }, ctx)).behavior).toBe('allow');
  });

  it('enforces the allowlist on run_command and rejects shell-operator chaining', async () => {
    const gate = makeCanUseTool(['npm']);
    expect((await gate('mcp__openrepl__run_command', { command: 'npm install' }, ctx)).behavior).toBe('allow');
    expect((await gate('mcp__openrepl__run_command', { command: 'rm -rf /' }, ctx)).behavior).toBe('deny');
    expect((await gate('mcp__openrepl__run_command', { command: 'npm test && rm -rf /' }, ctx)).behavior).toBe('deny');
  });
});

describe('canUseTool — read-only loop guard', () => {
  it('denies the 3rd identical read-only call (breaks a stuck list_dir loop)', async () => {
    const gate = makeCanUseTool([]);
    const call = () => gate('mcp__openrepl__list_dir', { path: '.' }, ctx);
    expect((await call()).behavior).toBe('allow'); // 1
    expect((await call()).behavior).toBe('allow'); // 2 (LOOP_LIMIT)
    expect((await call()).behavior).toBe('deny'); // 3 — loop broken
  });

  it('does not dedupe across different arguments', async () => {
    const gate = makeCanUseTool([]);
    await gate('mcp__openrepl__list_dir', { path: '.' }, ctx);
    await gate('mcp__openrepl__list_dir', { path: '.' }, ctx);
    // different path → fresh counter, still allowed
    expect((await gate('mcp__openrepl__list_dir', { path: 'src' }, ctx)).behavior).toBe('allow');
  });

  it('never dedupes side-effecting tools (write_file/run_app legitimately repeat in the fix loop)', async () => {
    const gate = makeCanUseTool([]);
    for (let i = 0; i < 5; i++) {
      expect((await gate('mcp__openrepl__write_file', { path: 'a', content: 'x' }, ctx)).behavior).toBe('allow');
      expect((await gate('mcp__openrepl__run_app', {}, ctx)).behavior).toBe('allow');
    }
  });
});
