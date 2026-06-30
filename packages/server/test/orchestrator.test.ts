import { describe, it, expect, vi, afterEach } from 'vitest';
import { runMultiAgent } from '../src/agent/orchestrator.js';
import { OpenRouterProvider } from '../src/providers/openrouter.js';
import { buildTools } from '../src/agent/tools.js';
import { Workspace } from '../src/workspace.js';
import { tmpWorkspace } from './helpers.js';
import type { UiEvent } from '@openrepl/shared';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('runMultiAgent (orchestrator delegates to coder)', () => {
  it('orchestrator → coder writes a file → tokens summed across the team', async () => {
    const ws = new Workspace(await tmpWorkspace());
    const tools = buildTools({ workspace: ws, runCommand: async () => ({ code: 0, output: '' }), commandAllowlist: [] });

    // Scripted LLM responses in call order:
    // 1) orchestrator delegates to coder
    // 2) coder calls write_file
    // 3) coder returns final text
    // 4) orchestrator returns final summary
    const scripted = [
      json({
        choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'd1', type: 'function', function: { name: 'delegate_to_coder', arguments: '{"task":"create a.js"}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
      }),
      json({
        choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'w1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.js","content":"console.log(1)"}' } }] } }],
        usage: { prompt_tokens: 20, completion_tokens: 6, cost: 0.002 },
      }),
      json({ choices: [{ message: { role: 'assistant', content: 'Wrote a.js' } }], usage: { prompt_tokens: 8, completion_tokens: 4, cost: 0.0005 } }),
      json({ choices: [{ message: { role: 'assistant', content: 'Team done: created a.js.' } }], usage: { prompt_tokens: 12, completion_tokens: 7, cost: 0.0015 } }),
    ];
    let i = 0;
    vi.stubGlobal('fetch', vi.fn(async () => scripted[i++]));

    const provider = new OpenRouterProvider(async () => 'k');
    const events: UiEvent[] = [];
    const result = await runMultiAgent({
      provider,
      runId: 'r1',
      messages: [{ role: 'user', content: 'build a.js' }],
      allTools: tools,
      model: 'm',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    });

    // coder actually wrote the file through the workspace tool
    expect(await ws.readFile('a.js')).toBe('console.log(1)');

    // the delegation AND the sub-agent's write are visible to the UI
    expect(events.some((e) => e.type === 'agent_tool_call' && e.name === 'delegate_to_coder')).toBe(true);
    expect(events.some((e) => e.type === 'agent_tool_call' && e.name === 'write_file')).toBe(true);

    // tokens/cost summed across orchestrator + coder
    expect(result.tokensIn).toBe(50);
    expect(result.tokensOut).toBe(22);
    expect(result.costUSD).toBeCloseTo(0.005);
    expect(result.text).toBe('Team done: created a.js.');
  });
});
