import type { ModelProvider } from './types.js';
import type { ProviderId } from '@openrepl/shared';
import { OpenRouterProvider } from './openrouter.js';
import { CodexProvider } from './codex-oauth.js';

export class ProviderRegistry {
  private providers: Record<ProviderId, ModelProvider>;

  constructor(getSecret: (key: string) => Promise<string | undefined>) {
    this.providers = {
      openrouter: new OpenRouterProvider(() =>
        getSecret('OPENROUTER_API_KEY').then((v) => v ?? process.env.OPENROUTER_API_KEY),
      ),
      codex: new CodexProvider(),
    };
  }

  get(id: ProviderId): ModelProvider {
    return this.providers[id] ?? this.providers.openrouter;
  }

  /** Pick a ready fallback when the active provider errors (e.g. Codex 401 → OpenRouter). */
  async fallbackFrom(id: ProviderId): Promise<ModelProvider | null> {
    const order: ProviderId[] = id === 'codex' ? ['openrouter'] : [];
    for (const candidate of order) {
      if (await this.providers[candidate].isReady()) return this.providers[candidate];
    }
    return null;
  }
}
