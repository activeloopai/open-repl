import type { SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UiEvent } from '@openrepl/shared';

/**
 * SDKMessage → UiEvent translation (PRD §4.4). Mirrors the AI-SDK loop's
 * mapping in runtime.ts:39-47 so the Web/Canvas UI is identical regardless of
 * engine:
 *   - assistant text block  → agent_token
 *   - assistant tool_use    → agent_tool_call
 *   - user tool_result      → agent_tool_result
 *
 * Subagent activity is tagged by `parent_tool_use_id` (non-null = produced by a
 * delegated Agent subagent). We forward subagent *tool* calls/results so file
 * writes still appear live (matching orchestrator.ts:63-65), but swallow
 * subagent *narration* tokens — only the main thread talks to the user.
 *
 * MCP tool names arrive prefixed (`mcp__openrepl__write_file`); we strip the
 * prefix so the UI sees the same bare names the AI-SDK path emits.
 */

const MCP_PREFIX = /^mcp__openrepl__/;

function stripPrefix(name: string): string {
  return name.replace(MCP_PREFIX, '');
}

/** A content block is loosely typed (the SDK's BetaMessage is structural). */
type Block = { type?: string; [k: string]: unknown };

function blocks(content: unknown): Block[] {
  if (Array.isArray(content)) return content as Block[];
  // A plain-string user/assistant message has no tool blocks to map.
  return [];
}

export function toUiEvents(msg: SDKMessage, runId: string): UiEvent[] {
  const out: UiEvent[] = [];

  if (msg.type === 'assistant') {
    const isSubagent = msg.parent_tool_use_id != null;
    for (const b of blocks(msg.message?.content)) {
      if (b.type === 'text' && !isSubagent) {
        const text = typeof b.text === 'string' ? b.text : '';
        if (text) out.push({ type: 'agent_token', runId, text });
      } else if (b.type === 'tool_use') {
        out.push({
          type: 'agent_tool_call',
          runId,
          id: String(b.id ?? ''),
          name: stripPrefix(String(b.name ?? '')),
          args: b.input,
        });
      }
    }
  } else if (msg.type === 'user') {
    for (const b of blocks(msg.message?.content)) {
      if (b.type === 'tool_result') {
        out.push({
          type: 'agent_tool_result',
          runId,
          id: String(b.tool_use_id ?? ''),
          result: b.content,
        });
      }
    }
  }

  return out;
}

export function isResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result';
}

export interface ResultUsage {
  tokensIn: number;
  tokensOut: number;
  costUSD: number;
  /** Final assistant text (success only); empty for an errored run. */
  text: string;
}

/**
 * Extract usage + cost from the terminal `result` message. Field names verified
 * against SDKResultSuccess/SDKResultError in
 * node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3946-3994: `usage`
 * (NonNullableUsage → BetaUsage: input_tokens / output_tokens /
 * cache_read_input_tokens / cache_creation_input_tokens), `total_cost_usd`, and
 * `result` (success subtype only).
 *
 * Cache reads/writes are counted into tokensIn: under subscription auth they
 * still draw from the plan's usage limits, so the dashboard/budget should see
 * the full consumed input.
 */
export function extractResult(msg: SDKResultMessage): ResultUsage {
  const u = msg.usage as {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  const tokensIn =
    (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  return {
    tokensIn,
    tokensOut: u.output_tokens ?? 0,
    costUSD: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : 0,
    text: msg.subtype === 'success' ? msg.result : '',
  };
}
