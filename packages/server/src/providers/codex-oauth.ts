import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { ModelProvider } from './types.js';

/**
 * Codex provider — uses the ChatGPT subscription (flat) instead of pay-per-token.
 *
 * ⚠️ SCAFFOLD: reads an existing `codex login` token READ-ONLY (we never write
 * outside the project). The full OAuth+PKCE flow (à la Roo/Cline) is not yet
 * implemented — needs a real ChatGPT account to verify. Reports plan units, not $.
 */
export class CodexProvider implements ModelProvider {
  readonly id = 'codex' as const;
  readonly reportsCostUSD = false;
  readonly flatSubscription = true;

  private async readAuth(): Promise<{ accessToken: string; baseURL?: string } | null> {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    try {
      const parsed = JSON.parse(await fs.readFile(authPath, 'utf8'));
      const accessToken = parsed?.tokens?.access_token ?? parsed?.access_token ?? parsed?.OPENAI_API_KEY;
      return accessToken ? { accessToken, baseURL: parsed?.base_url } : null;
    } catch {
      return null;
    }
  }

  async isReady(): Promise<boolean> {
    return Boolean(await this.readAuth());
  }

  async getModel(modelId: string): Promise<LanguageModel> {
    const auth = await this.readAuth();
    if (!auth) {
      throw new Error('Codex not authenticated. Run `codex login` first, or use OpenRouter. (OAuth flow not yet implemented.)');
    }
    const openai = createOpenAI({ apiKey: auth.accessToken, baseURL: auth.baseURL });
    return openai(modelId);
  }
}
