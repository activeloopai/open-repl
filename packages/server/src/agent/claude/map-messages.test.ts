import { describe, it, expect } from 'vitest';
import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UiEvent } from '@openrepl/shared';
import { toUiEvents, isResultMessage, extractResult } from './map-messages.js';

/**
 * Unit tests for the SDKMessage → UiEvent translation (PRD §4.4). The mapper is
 * the seam between the Claude Agent SDK and the existing Web/Canvas UI: get it
 * wrong and live editor sync, the streamed assistant text, or the tool log break
 * silently. These fixtures mirror the real SDK message shapes verified against
 * node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts (SDKAssistantMessage
 * :2723, SDKUserMessage :4236, SDKResultSuccess :3968, SDKResultError :3946).
 *
 * The fields the mapper actually reads are a structural subset, so we cast loose
 * literals to SDKMessage rather than constructing every optional field.
 */

const RUN = 'run-1';

function assistant(content: unknown[], parentToolUseId: string | null = null): SDKMessage {
  return {
    type: 'assistant',
    message: { content } as never,
    parent_tool_use_id: parentToolUseId,
  } as unknown as SDKMessage;
}

function user(content: unknown[], parentToolUseId: string | null = null): SDKMessage {
  return {
    type: 'user',
    message: { content } as never,
    parent_tool_use_id: parentToolUseId,
  } as unknown as SDKMessage;
}

describe('toUiEvents — assistant text', () => {
  it('main-thread text block becomes a single agent_token', () => {
    const out = toUiEvents(assistant([{ type: 'text', text: 'Building the app…' }]), RUN);
    expect(out).toEqual<UiEvent[]>([{ type: 'agent_token', runId: RUN, text: 'Building the app…' }]);
  });

  it('swallows subagent narration — only the main thread talks to the user', () => {
    // parent_tool_use_id != null ⇒ produced by a delegated Agent subagent.
    const out = toUiEvents(assistant([{ type: 'text', text: 'planner thinking…' }], 'tool_abc'), RUN);
    expect(out).toEqual([]);
  });

  it('drops empty text blocks (no zero-length agent_token spam)', () => {
    const out = toUiEvents(assistant([{ type: 'text', text: '' }]), RUN);
    expect(out).toEqual([]);
  });

  it('a plain-string message (no content array) yields no events', () => {
    const msg = { type: 'assistant', message: { content: 'hi' }, parent_tool_use_id: null } as unknown as SDKMessage;
    expect(toUiEvents(msg, RUN)).toEqual([]);
  });
});

describe('toUiEvents — tool calls', () => {
  it('strips the mcp__openrepl__ prefix so the UI sees bare tool names', () => {
    const msg = assistant([
      { type: 'tool_use', id: 'tu_1', name: 'mcp__openrepl__write_file', input: { path: 'app.py', content: 'x' } },
    ]);
    const out = toUiEvents(msg, RUN);
    expect(out).toEqual<UiEvent[]>([
      { type: 'agent_tool_call', runId: RUN, id: 'tu_1', name: 'write_file', args: { path: 'app.py', content: 'x' } },
    ]);
  });

  it('leaves a non-MCP tool name (the built-in Agent delegate) untouched', () => {
    const out = toUiEvents(assistant([{ type: 'tool_use', id: 'd1', name: 'Agent', input: { description: 'plan it' } }]), RUN);
    expect(out[0]).toMatchObject({ type: 'agent_tool_call', name: 'Agent', id: 'd1' });
  });

  it('FORWARDS subagent tool calls so delegated file writes still appear live', () => {
    // A coder subagent's write_file: text is swallowed (above) but the tool call
    // must survive — this is what keeps the editor syncing (orchestrator.ts:63-65).
    const msg = assistant(
      [{ type: 'tool_use', id: 'tu_9', name: 'mcp__openrepl__write_file', input: { path: 'a.js', content: '1' } }],
      'tool_parent',
    );
    const out = toUiEvents(msg, RUN);
    expect(out).toEqual<UiEvent[]>([
      { type: 'agent_tool_call', runId: RUN, id: 'tu_9', name: 'write_file', args: { path: 'a.js', content: '1' } },
    ]);
  });

  it('maps text + tool_use in one assistant message, in order', () => {
    const out = toUiEvents(
      assistant([
        { type: 'text', text: 'Writing it.' },
        { type: 'tool_use', id: 't2', name: 'mcp__openrepl__run_app', input: {} },
      ]),
      RUN,
    );
    expect(out.map((e) => e.type)).toEqual(['agent_token', 'agent_tool_call']);
  });
});

describe('toUiEvents — tool results', () => {
  it('user tool_result becomes agent_tool_result keyed by tool_use_id', () => {
    const out = toUiEvents(user([{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":true}' }]), RUN);
    expect(out).toEqual<UiEvent[]>([{ type: 'agent_tool_result', runId: RUN, id: 'tu_1', result: '{"ok":true}' }]);
  });

  it('forwards subagent tool results too (run_app output from the coder)', () => {
    const out = toUiEvents(
      user([{ type: 'tool_result', tool_use_id: 'tu_9', content: 'served' }], 'tool_parent'),
      RUN,
    );
    expect(out).toEqual<UiEvent[]>([{ type: 'agent_tool_result', runId: RUN, id: 'tu_9', result: 'served' }]);
  });

  it('non-mapped message types (result) produce no UI events', () => {
    const msg = { type: 'result', subtype: 'success' } as unknown as SDKMessage;
    expect(toUiEvents(msg, RUN)).toEqual([]);
  });
});

describe('isResultMessage', () => {
  it('is true only for the terminal result message', () => {
    expect(isResultMessage({ type: 'result' } as unknown as SDKMessage)).toBe(true);
    expect(isResultMessage(assistant([]))).toBe(false);
    expect(isResultMessage(user([]))).toBe(false);
  });
});

describe('extractResult — usage & cost', () => {
  function success(usage: Record<string, number>, cost: number, text: string): SDKResultMessage {
    return { type: 'result', subtype: 'success', usage, total_cost_usd: cost, result: text } as unknown as SDKResultMessage;
  }

  it('sums input + cache-read + cache-write into tokensIn (subscription draws on all of it)', () => {
    const r = extractResult(
      success(
        { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
        0.0123,
        'done',
      ),
    );
    expect(r.tokensIn).toBe(100 + 1000 + 200);
    expect(r.tokensOut).toBe(40);
    expect(r.costUSD).toBe(0.0123);
    expect(r.text).toBe('done');
  });

  it('defaults missing usage fields to zero rather than NaN', () => {
    const r = extractResult(success({ input_tokens: 5 }, 0, 'ok'));
    expect(r.tokensIn).toBe(5); // no cache fields → not NaN
    expect(r.tokensOut).toBe(0);
    expect(r.costUSD).toBe(0);
  });

  it('a non-numeric total_cost_usd falls back to 0', () => {
    const msg = { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 }, result: 'x' } as unknown as SDKResultMessage;
    expect(extractResult(msg).costUSD).toBe(0);
  });

  it('an errored run carries usage but an empty text (no result field)', () => {
    const err = {
      type: 'result',
      subtype: 'error_max_turns',
      usage: { input_tokens: 50, output_tokens: 10 },
      total_cost_usd: 0.002,
    } as unknown as SDKResultMessage;
    const r = extractResult(err);
    expect(r.text).toBe('');
    expect(r.tokensIn).toBe(50);
    expect(r.tokensOut).toBe(10);
    expect(r.costUSD).toBe(0.002);
  });
});
