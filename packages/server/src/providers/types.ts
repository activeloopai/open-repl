import type { LanguageModel } from 'ai';
import type { Message, ProviderId, UiEvent } from '@openrepl/shared';

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema for parameters (OpenAI function-calling format). */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface AgentRun {
  runId: string;
  messages: Message[];
  tools: AgentTool[];
  model: string;
  maxSteps: number;
  signal: AbortSignal;
  /** Optional system prompt override (used to give each sub-agent its own role). */
  systemPrompt?: string;
  emit(event: UiEvent): void;
}

export interface RunResult {
  tokensIn: number;
  tokensOut: number;
  costUSD: number | null;
  planUnits: number | null;
  /** Final assistant text (for memory persistence). */
  text: string;
}

/**
 * A provider is a *model factory*: it knows how to build an AI SDK
 * LanguageModel for a given model id, plus how its costs are reported.
 * The agent loop itself lives once in agent/runtime.ts (DRY).
 */
export interface ModelProvider {
  id: ProviderId;
  /** True when usable (has credentials). */
  isReady(): Promise<boolean>;
  /** Build an AI SDK model for the given model id. Throws if not authenticated. */
  getModel(modelId: string): Promise<LanguageModel>;
  /** OpenRouter reports real $ (via providerMetadata). */
  reportsCostUSD: boolean;
  /** Codex is a flat subscription → report plan units, not $. */
  flatSubscription: boolean;
}

export class ProviderError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export const SYSTEM_PROMPT = `You are OpenREPL, a coding agent working inside a user's local project.
You can read, write, list and search files, run shell commands, and run the app — all scoped to the workspace.
Prefer small, verifiable steps. When you create or edit files, the user sees them update live in the editor.
CRITICAL: after writing code, call run_app to verify it actually runs. If it returns ok:false, read the
error/traceback, fix the file(s), and call run_app again — repeat until it runs. Never finish with a broken app.
Be concise. When it runs, briefly say what you built and confirm it runs.`;

export function toMessageHistory(messages: Message[]): { role: string; content: string }[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}
