import type { ModelProvider } from './types.js';
import type { ProviderId } from '@openrepl/shared';
import { OpenRouterProvider } from './openrouter.js';
import { CodexProvider } from './codex-oauth.js';
import { ClaudeProvider } from './claude.js';

export class ProviderRegistry {
  private providers: Record<ProviderId, ModelProvider>;
  private claude: ClaudeProvider;

  constructor(getSecret: (key: string) => Promise<string | undefined>) {
    // Subscription default with fallback to ANTHROPIC_API_KEY (Secrets → env),
    // same pattern as OPENROUTER_API_KEY above (PRD §5).
    this.claude = new ClaudeProvider(() =>
      getSecret('ANTHROPIC_API_KEY').then((v) => v ?? process.env.ANTHROPIC_API_KEY),
    );
    this.providers = {
      openrouter: new OpenRouterProvider(() =>
        getSecret('OPENROUTER_API_KEY').then((v) => v ?? process.env.OPENROUTER_API_KEY),
      ),
      codex: new CodexProvider(),
      claude: this.claude,
    };
  }

  /** ANTHROPIC_API_KEY for the Claude engine; `undefined` ⇒ use the subscription. */
  claudeApiKey(): Promise<string | undefined> {
    return this.claude.getApiKey();
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
