import { streamText, stepCountIs, tool as defineTool, jsonSchema, type ToolSet, type ModelMessage } from 'ai';
import type { AgentRun, RunResult, ModelProvider } from '../providers/types.js';
import { SYSTEM_PROMPT } from '../providers/types.js';

/**
 * The single agent loop, built on the Vercel AI SDK. Every agent and sub-agent
 * goes through here (DRY). Providers only supply the model + cost flags.
 */
async function runWithModel(
  provider: Pick<ModelProvider, 'reportsCostUSD' | 'flatSubscription'>,
  model: Awaited<ReturnType<ModelProvider['getModel']>>,
  run: AgentRun,
): Promise<RunResult> {
  const tools: ToolSet = Object.fromEntries(
    run.tools.map((t) => [
      t.name,
      defineTool({
        description: t.description,
        inputSchema: jsonSchema(t.parameters),
        execute: async (args) => t.execute((args ?? {}) as Record<string, unknown>),
      }),
    ]),
  );

  const messages: ModelMessage[] = run.messages.map((m) => ({ role: m.role, content: m.content }));

  const result = streamText({
    model,
    system: run.systemPrompt ?? SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: stepCountIs(run.maxSteps),
    abortSignal: run.signal,
  });

  let finalText = '';
  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'text-delta':
        finalText += part.text;
        run.emit({ type: 'agent_token', runId: run.runId, text: part.text });
        break;
      case 'tool-call':
        run.emit({ type: 'agent_tool_call', runId: run.runId, id: part.toolCallId, name: part.toolName, args: part.input });
        break;
      case 'tool-result':
        run.emit({ type: 'agent_tool_result', runId: run.runId, id: part.toolCallId, result: part.output });
        break;
      case 'error':
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }

  const usage = await result.totalUsage;
  const tokensIn = usage.inputTokens ?? 0;
  const tokensOut = usage.outputTokens ?? 0;

  let costUSD: number | null = null;
  let planUnits: number | null = null;
  if (provider.flatSubscription) {
    planUnits = tokensIn + tokensOut;
  } else if (provider.reportsCostUSD) {
    const meta = (await result.providerMetadata) as Record<string, any> | undefined;
    const cost = meta?.openrouter?.usage?.cost;
    costUSD = typeof cost === 'number' ? cost : 0;
  }

  return { tokensIn, tokensOut, costUSD, planUnits, text: finalText };
}

/** Resolve the model for a provider+modelId and run the loop. Single call site. */
export async function runRole(provider: ModelProvider, modelId: string, run: AgentRun): Promise<RunResult> {
  const model = await provider.getModel(modelId);
  return runWithModel(provider, model, run);
}
