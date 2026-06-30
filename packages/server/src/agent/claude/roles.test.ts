import { describe, it, expect } from 'vitest';
import { roles } from './roles.js';
import { mcpToolName } from './tools.js';

/**
 * Unit tests for the role → AgentDefinition map (PRD §4.2), reflecting the
 * e2e-validated shape: the orchestrator (main thread) does the coding through
 * the in-process MCP tools (reliable there), while planner and reviewer are
 * read-only advisory subagents using built-in tools (the in-process MCP server
 * is unreliable for delegated subagents that write files — see roles.ts).
 * Contracts the product depends on:
 *   1. Per-role model tiers — Haiku (cheap planner), Sonnet (reviewer), Opus
 *      (orchestrator, which does the heavy coding) — config-overridable.
 *   2. Tool subsets (least privilege): only the orchestrator can mutate files
 *      (and only via the gated MCP tools); planner/reviewer are read-only.
 */

const mcp = (...names: string[]) => names.map(mcpToolName);

describe('roles — default model tiers (PRD §4.2)', () => {
  it('assigns Haiku→planner, Sonnet→reviewer, Opus→orchestrator', () => {
    const r = roles();
    expect(r.orchestrator.model).toBe('opus');
    expect(r.planner.model).toBe('haiku');
    expect(r.reviewer.model).toBe('sonnet');
  });

  it('exposes orchestrator, planner, reviewer', () => {
    expect(Object.keys(roles()).sort()).toEqual(['orchestrator', 'planner', 'reviewer']);
  });
});

describe('roles — config overrides the tier per role', () => {
  it('honors a per-role model override', () => {
    const r = roles({ models: { orchestrator: 'sonnet', planner: 'opus' } });
    expect(r.orchestrator.model).toBe('sonnet');
    expect(r.planner.model).toBe('opus');
    expect(r.reviewer.model).toBe('sonnet'); // un-overridden keeps default
  });

  it('an empty-string override is ignored (falls back to the default tier)', () => {
    const r = roles({ models: { orchestrator: '' } });
    expect(r.orchestrator.model).toBe('opus');
  });
});

describe('roles — tool subsets (least privilege)', () => {
  it('orchestrator: Agent delegate + the six MCP tools (it does the coding)', () => {
    expect(roles().orchestrator.tools).toEqual([
      'Agent',
      ...mcp('read_file', 'write_file', 'list_dir', 'search_repo', 'run_command', 'run_app'),
    ]);
  });

  it('planner: read-only built-ins, nothing that mutates or runs', () => {
    const tools = roles().planner.tools!;
    expect(tools).toEqual(['Read', 'Glob', 'Grep']);
    for (const forbidden of ['Write', 'Edit', 'Bash']) expect(tools).not.toContain(forbidden);
  });

  it('reviewer: strictly read-only built-ins — no Write/Edit and no Bash (would defeat read-only under the default allow-all allowlist)', () => {
    const tools = roles().reviewer.tools!;
    expect(tools).toEqual(['Read', 'Glob', 'Grep']);
    for (const forbidden of ['Write', 'Edit', 'Bash']) expect(tools).not.toContain(forbidden);
  });

  it('subagents never receive an MCP tool (unreliable for delegated agents)', () => {
    const r = roles();
    for (const role of ['planner', 'reviewer'] as const) {
      for (const t of r[role].tools!) expect(t).not.toMatch(/^mcp__openrepl__/);
    }
  });
});

describe('roles — prompts', () => {
  it('orchestrator codes itself, delegates plan/review by name, and verifies via run_app', () => {
    const prompt = roles().orchestrator.prompt.toLowerCase();
    expect(prompt).not.toMatch(/delegate_to_/); // not the legacy AI-SDK tool names
    expect(prompt).toContain('planner');
    expect(prompt).toContain('reviewer');
    expect(prompt).toContain('run_app');
    expect(prompt).toMatch(/yourself|implement the plan/); // it does the coding, not a coder subagent
  });

  it('planner/reviewer prompts are read-only', () => {
    const r = roles();
    expect(r.planner.prompt.toLowerCase()).toContain('do not write');
    expect(r.reviewer.prompt.toLowerCase()).toContain('do not edit');
  });
});
