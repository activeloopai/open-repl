import { describe, it, expect, afterEach } from 'vitest';
import { ClaudeProvider } from '../src/providers/claude.js';

/**
 * ClaudeProvider readiness: ready when SOME credential exists (API key or
 * subscription OAuth token), so the UI doesn't report "ready" on a host with no
 * auth and then fail at run start. getModel must throw — this provider runs via
 * the Agent SDK engine, not the AI-SDK model path.
 */
const savedToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
afterEach(() => {
  if (savedToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  else process.env.CLAUDE_CODE_OAUTH_TOKEN = savedToken;
});

describe('ClaudeProvider', () => {
  it('is ready when an API key is available', async () => {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const p = new ClaudeProvider(async () => 'sk-ant-xxx');
    expect(await p.isReady()).toBe(true);
    expect(await p.getApiKey()).toBe('sk-ant-xxx');
  });

  it('is ready via a subscription OAuth token when no API key is set', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token';
    const p = new ClaudeProvider(async () => undefined);
    expect(await p.isReady()).toBe(true);
  });

  it('reports plan-units mode (flat subscription, no $ by default)', () => {
    const p = new ClaudeProvider(async () => undefined);
    expect(p.flatSubscription).toBe(true);
    expect(p.reportsCostUSD).toBe(false);
  });

  it('getModel throws — the turn runs through ClaudeAgentEngine, not the AI-SDK path', async () => {
    const p = new ClaudeProvider(async () => 'k');
    await expect(p.getModel()).rejects.toThrow();
  });
});
