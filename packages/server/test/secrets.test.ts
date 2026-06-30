import { describe, it, expect } from 'vitest';
import { Secrets, parseEnv } from '../src/secrets.js';
import { tmpWorkspace } from './helpers.js';

describe('Secrets', () => {
  it('parses .env content', () => {
    const env = parseEnv('# comment\nA=1\nB="two words"\n\nC=\n');
    expect(env).toEqual({ A: '1', B: 'two words', C: '' });
  });

  it('sets, lists and removes secrets persisted to .env', async () => {
    const dir = await tmpWorkspace();
    const s = new Secrets(dir);
    await s.set('OPENROUTER_API_KEY', 'sk-test');
    expect(await s.keys()).toContain('OPENROUTER_API_KEY');
    expect((await s.all()).OPENROUTER_API_KEY).toBe('sk-test');

    const reloaded = new Secrets(dir);
    expect((await reloaded.all()).OPENROUTER_API_KEY).toBe('sk-test');

    await s.remove('OPENROUTER_API_KEY');
    expect(await s.keys()).not.toContain('OPENROUTER_API_KEY');
  });

  it('rejects invalid env keys', async () => {
    const s = new Secrets(await tmpWorkspace());
    await expect(s.set('bad-key', 'x')).rejects.toThrow(/Invalid env key/);
  });
});
