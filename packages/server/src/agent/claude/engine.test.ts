import { describe, it, expect } from 'vitest';
import { makeCanUseTool } from './engine.js';

/**
 * Tests for the permission gate (canUseTool). These catch real bugs the e2e
 * surfaced: a stuck read-only loop that burned the turn budget, and the command
 * allowlist (bypass + gating). canUseTool ignores its 3rd arg, so we pass {}.
 */
const ctx = {} as never;

describe('canUseTool — default-allow + allowlist', () => {
  it('default-allows tools it does not specifically gate (incl. SDK-internal tools)', async () => {
    // Must NOT block SDK-internal tools (e.g. TodoWrite) — a deny-unless-listed
    // gate stalled real runs. Per-role tool restriction is via AgentDefinition.
    const gate = makeCanUseTool([]);
    expect((await gate('TodoWrite', { todos: [] }, ctx)).behavior).toBe('allow');
    expect((await gate('Read', { file_path: 'a' }, ctx)).behavior).toBe('allow');
    expect((await gate('mcp__openrepl__run_command', { command: 'rm -rf /' }, ctx)).behavior).toBe('allow');
  });

  it('enforces the allowlist on run_command and rejects shell-operator chaining', async () => {
    const gate = makeCanUseTool(['npm']);
    expect((await gate('mcp__openrepl__run_command', { command: 'npm install' }, ctx)).behavior).toBe('allow');
    expect((await gate('mcp__openrepl__run_command', { command: 'rm -rf /' }, ctx)).behavior).toBe('deny');
    expect((await gate('mcp__openrepl__run_command', { command: 'npm test && rm -rf /' }, ctx)).behavior).toBe('deny');
  });

  it('matches the allowlist on a command boundary (npm does not allow npmx)', async () => {
    const gate = makeCanUseTool(['npm', 'git status']);
    expect((await gate('mcp__openrepl__run_command', { command: 'npm' }, ctx)).behavior).toBe('allow');
    expect((await gate('mcp__openrepl__run_command', { command: 'npmx run evil' }, ctx)).behavior).toBe('deny');
    expect((await gate('mcp__openrepl__run_command', { command: 'git status' }, ctx)).behavior).toBe('allow');
    expect((await gate('mcp__openrepl__run_command', { command: 'git statusx' }, ctx)).behavior).toBe('deny');
  });
});

describe('canUseTool — read-only loop guard', () => {
  it('denies only after a clearly-stuck run of identical read-only calls (LOOP_LIMIT=8)', async () => {
    const gate = makeCanUseTool([]);
    const call = () => gate('mcp__openrepl__list_dir', { path: '.' }, ctx);
    for (let i = 0; i < 8; i++) expect((await call()).behavior).toBe('allow'); // 1..8 legit re-reads
    expect((await call()).behavior).toBe('deny'); // 9th — runaway loop broken
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
