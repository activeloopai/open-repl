import { describe, it, expect } from 'vitest';
import { DemoProvider } from '../src/providers/demo.js';
import { buildTools } from '../src/agent/tools.js';
import { Workspace } from '../src/workspace.js';
import { tmpWorkspace } from './helpers.js';
import type { UiEvent } from '@openrepl/shared';
import type { AgentRun } from '../src/providers/types.js';

describe('DemoProvider', () => {
  it('creates a file when asked, emitting tool events the UI can render', async () => {
    const ws = new Workspace(await tmpWorkspace());
    const tools = buildTools({ workspace: ws, runCommand: async () => ({ code: 0, output: '' }), commandAllowlist: [] });
    const events: UiEvent[] = [];
    const run: AgentRun = {
      runId: 'run1',
      messages: [{ role: 'user', content: 'create a file hello.js' }],
      tools,
      model: 'demo',
      maxSteps: 5,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    };

    const result = await new DemoProvider().run(run);

    // it actually wrote the file
    expect(await ws.readFile('hello.js')).toContain('Hello from hello.js');
    // it emitted a tool_call + tool_result + some tokens
    expect(events.some((e) => e.type === 'agent_tool_call' && e.name === 'write_file')).toBe(true);
    expect(events.some((e) => e.type === 'agent_tool_result')).toBe(true);
    expect(events.some((e) => e.type === 'agent_token')).toBe(true);
    expect(result.text).toContain('hello.js');
  });

  it('gives guidance when no file intent is present', async () => {
    const events: UiEvent[] = [];
    const run: AgentRun = {
      runId: 'r',
      messages: [{ role: 'user', content: 'hi there' }],
      tools: [],
      model: 'demo',
      maxSteps: 5,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    };
    const result = await new DemoProvider().run(run);
    expect(result.text.toLowerCase()).toContain('demo');
  });
});
