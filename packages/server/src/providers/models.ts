import type { ModelInfo, ProviderId } from '@openrepl/shared';

/**
 * List selectable models for a provider. For OpenRouter we hit the public
 * /models catalog and keep only models that support tool calling (the agent
 * loop needs it). For Codex/demo we return a small static set.
 */
export async function listModels(provider: ProviderId): Promise<ModelInfo[]> {
  if (provider === 'openrouter') return listOpenRouterModels();
  if (provider === 'claude') {
    // Claude Agent SDK model aliases (what AgentDefinition.model accepts).
    return [
      { id: 'haiku', name: 'Claude Haiku (cheap)' },
      { id: 'sonnet', name: 'Claude Sonnet (balanced)' },
      { id: 'opus', name: 'Claude Opus (strong)' },
      { id: 'fable', name: 'Claude Fable (max)' },
    ];
  }
  // codex (ChatGPT subscription) — static set
  return [
    { id: 'gpt-5.1', name: 'GPT-5.1' },
    { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
    { id: 'gpt-5-mini', name: 'GPT-5 mini' },
    { id: 'o4-mini', name: 'o4-mini' },
  ];
}

async function listOpenRouterModels(): Promise<ModelInfo[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { accept: 'application/json' } });
    if (!res.ok) return FALLBACK;
    const data: any = await res.json();
    const models: ModelInfo[] = (data?.data ?? [])
      .filter((m: any) => !m.supported_parameters || m.supported_parameters.includes('tools'))
      .map((m: any) => ({
        id: m.id as string,
        name: (m.name as string) ?? m.id,
        promptUsdPerM: priceToPerM(m?.pricing?.prompt),
        completionUsdPerM: priceToPerM(m?.pricing?.completion),
      }))
      .sort((a: ModelInfo, b: ModelInfo) => a.id.localeCompare(b.id));
    return models.length ? models : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function priceToPerM(price: unknown): number | undefined {
  const n = typeof price === 'string' ? Number(price) : typeof price === 'number' ? price : NaN;
  return Number.isFinite(n) ? Number((n * 1_000_000).toFixed(4)) : undefined;
}

const FALLBACK: ModelInfo[] = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
];
