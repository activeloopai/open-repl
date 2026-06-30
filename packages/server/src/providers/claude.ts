import type { LanguageModel } from 'ai';
import type { ModelProvider } from './types.js';

/**
 * Claude provider — backed by the Claude Agent SDK via `ClaudeAgentEngine`
 * (PRD §5), NOT the Vercel AI-SDK model path. Auth is subscription-first: the
 * SDK reads the local Claude credential when no API key is set, so `isReady` is
 * always true. An `ANTHROPIC_API_KEY` (workspace .env via Secrets, or env) is
 * the pay-as-you-go fallback, surfaced to the engine via {@link getApiKey} —
 * its presence flips usage from plan units to real $ inside the engine.
 *
 * Because the turn runs through the engine, `getModel` is never called on this
 * path and throws if it is (it has no AI-SDK model to build).
 */
export class ClaudeProvider implements ModelProvider {
  readonly id = 'claude' as const;
  // Subscription default → plan units. The engine itself reports $ when an API
  // key is present; these flags only describe the default (subscription) mode.
  readonly reportsCostUSD = false;
  readonly flatSubscription = true;

  constructor(private getKey: () => Promise<string | undefined>) {}

  /** Subscription is the default credential, so a run can always be attempted. */
  async isReady(): Promise<boolean> {
    return true;
  }

  /**
   * ANTHROPIC_API_KEY (Secrets → process.env). `undefined` means no API key —
   * the engine then runs on the local Claude subscription credential.
   */
  async getApiKey(): Promise<string | undefined> {
    return this.getKey();
  }

  async getModel(): Promise<LanguageModel> {
    throw new Error('ClaudeProvider runs via ClaudeAgentEngine, not the AI-SDK model path.');
  }
}
