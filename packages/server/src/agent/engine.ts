import type { Message, UiEvent } from '@openrepl/shared';
import type { RunResult } from '../providers/types.js';
import type { OpenReplConfig } from '../config.js';
import type { ToolDeps } from './tools.js';

/**
 * Engine abstraction (PRD §4.1). One turn = run a prompt, stream UiEvents via
 * `emit`, return the same {@link RunResult} the AI-SDK path produces. This lets
 * `session.ts` pick a backend (Claude Agent SDK vs the legacy Vercel AI SDK
 * loop) without knowing which one runs the turn.
 *
 * The shape mirrors {@link AgentRun} in providers/types.ts: instead of a
 * pre-built tool list + model id, the engine receives the workspace/shell
 * {@link ToolDeps} (so it can expose them as in-process MCP tools) and the full
 * {@link OpenReplConfig} (default model + per-role tiers).
 */
export interface EngineRun {
  runId: string;
  /** Conversation so far (running history from session memory). */
  messages: Message[];
  /** Default model + per-role model overrides + command allowlist + caps. */
  config: OpenReplConfig;
  /** Workspace / shell / run_app wrappers — the exact deps the AI-SDK tools use. */
  deps: ToolDeps;
  /** Stop button: aborting this fires the engine's own AbortController. */
  signal: AbortSignal;
  /** Forward agent_token / agent_tool_call / agent_tool_result to the UI. */
  emit: (event: UiEvent) => void;
  /**
   * Pay-as-you-go credential. When present it is the auth fallback
   * (ANTHROPIC_API_KEY); when absent the local Claude subscription is used and
   * usage is recorded as plan units at $0 (PRD §4.4 / §5).
   */
  apiKey?: string;
}

export interface AgentEngine {
  run(args: EngineRun): Promise<RunResult>;
}

export type { RunResult };
