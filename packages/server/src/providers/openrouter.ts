import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { ModelProvider } from './types.js';

/**
 * OpenRouter: any of 600+ models with one API key, pay-per-token.
 * Reports REAL $ cost (via providerMetadata.openrouter.usage.cost).
 * Key comes from OPENROUTER_API_KEY (workspace .env via Secrets, or env).
 */
export class OpenRouterProvider implements ModelProvider {
  readonly id = 'openrouter' as const;
  readonly reportsCostUSD = true;
  readonly flatSubscription = false;

  constructor(private getKey: () => Promise<string | undefined>) {}

  async isReady(): Promise<boolean> {
    return Boolean(await this.getKey());
  }

  async getModel(modelId: string): Promise<LanguageModel> {
    const apiKey = await this.getKey();
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set — add it in Secrets.');
    const openrouter = createOpenRouter({ apiKey, extraBody: { usage: { include: true } } });
    return openrouter(modelId);
  }
}
