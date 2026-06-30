import { describe, it, expect, vi, afterEach } from 'vitest';
import { runOpenAICompatible } from '../src/providers/openai-compatible.js';
import type { AgentRun, AgentTool } from '../src/providers/types.js';
import type { UiEvent } from '@openrepl/shared';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('runOpenAICompatible (mocked endpoint)', () => {
  it('executes a tool call, loops, and aggregates tokens + cost', async () => {
    const calls: any[] = [];
    let executed = false;
    const writeTool: AgentTool = {
      name: 'write_file',
      description: 'w',
      parameters: { type: 'object', properties: {} },
      async execute(args) {
        executed = true;
        return { ok: true, got: args };
      },
    };

    const fetchMock = vi.fn(async (_url: string, init: any) => {
      calls.push(JSON.parse(init.body));
      if (fetchMock.mock.calls.length === 1) {
        // step 1: model asks to call the tool
        return jsonResponse({
          choices: [
            { message: { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.js"}' } }] } },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
        });
      }
      // step 2: model returns final text
      return jsonResponse({
        choices: [{ message: { role: 'assistant', content: 'All done.' } }],
        usage: { prompt_tokens: 8, completion_tokens: 4, cost: 0.002 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const events: UiEvent[] = [];
    const run: AgentRun = {
      runId: 'r1',
      messages: [{ role: 'user', content: 'make a.js' }],
      tools: [writeTool],
      model: 'test-model',
      maxSteps: 5,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
    };

    const result = await runOpenAICompatible({ baseURL: 'https://x/v1', apiKey: 'k', reportsCostUSD: true }, run);

    expect(executed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.tokensIn).toBe(18);
    expect(result.tokensOut).toBe(9);
    expect(result.costUSD).toBeCloseTo(0.003);
    expect(result.text).toBe('All done.');
    expect(events.some((e) => e.type === 'agent_tool_call' && e.name === 'write_file')).toBe(true);
    expect(events.some((e) => e.type === 'agent_tool_result')).toBe(true);
    expect(events.filter((e) => e.type === 'agent_token').map((e) => (e as any).text).join('')).toBe('All done.');
    // the request carried our tool schema
    expect(calls[0].tools[0].function.name).toBe('write_file');
  });

  it('throws ProviderError on non-OK status (for fallback handling)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    const run: AgentRun = {
      runId: 'r',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      model: 'm',
      maxSteps: 2,
      signal: new AbortController().signal,
      emit: () => {},
    };
    await expect(runOpenAICompatible({ baseURL: 'https://x/v1', apiKey: 'k', reportsCostUSD: false }, run)).rejects.toMatchObject({
      name: 'ProviderError',
      status: 429,
    });
  });
});
