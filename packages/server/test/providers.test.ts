import { describe, it, expect } from 'vitest';
import { ProviderError, toMessageHistory } from '../src/providers/types.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { OpenRouterProvider } from '../src/providers/openrouter.js';
import { CodexProvider } from '../src/providers/codex-oauth.js';

describe('providers/types', () => {
  it('toMessageHistory maps role + content', () => {
    expect(toMessageHistory([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
  });
  it('ProviderError carries an HTTP status', () => {
    const e = new ProviderError(429, 'rate');
    expect(e.status).toBe(429);
    expect(e.name).toBe('ProviderError');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('ProviderRegistry', () => {
  it('get returns the requested provider; unknown ids fall back to openrouter', () => {
    const r = new ProviderRegistry(async () => undefined);
    expect(r.get('claude').id).toBe('claude');
    expect(r.get('codex').id).toBe('codex');
    expect(r.get('openrouter').id).toBe('openrouter');
    expect(r.get('nope' as never).id).toBe('openrouter');
  });
  it('claudeApiKey reads ANTHROPIC_API_KEY through getSecret', async () => {
    const r = new ProviderRegistry(async (k) => (k === 'ANTHROPIC_API_KEY' ? 'sk-x' : undefined));
    expect(await r.claudeApiKey()).toBe('sk-x');
  });
  it('fallbackFrom(codex) → openrouter when openrouter has a key; null otherwise', async () => {
    const withKey = new ProviderRegistry(async (k) => (k === 'OPENROUTER_API_KEY' ? 'k' : undefined));
    expect((await withKey.fallbackFrom('codex'))?.id).toBe('openrouter');
    const noKey = new ProviderRegistry(async () => undefined);
    expect(await noKey.fallbackFrom('codex')).toBeNull();
    expect(await withKey.fallbackFrom('openrouter')).toBeNull();
  });
});

describe('OpenRouterProvider', () => {
  it('isReady reflects key presence and getModel needs a key', async () => {
    expect(await new OpenRouterProvider(async () => undefined).isReady()).toBe(false);
    await expect(new OpenRouterProvider(async () => undefined).getModel('x')).rejects.toThrow();
    const p = new OpenRouterProvider(async () => 'k');
    expect(await p.isReady()).toBe(true);
    expect(await p.getModel('anthropic/claude-sonnet-4.6')).toBeTruthy(); // builds a model, no network
  });
});

describe('CodexProvider', () => {
  it('isReady resolves to a boolean without throwing', async () => {
    expect(typeof (await new CodexProvider().isReady())).toBe('boolean');
  });
});
