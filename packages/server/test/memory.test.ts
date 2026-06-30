import { describe, it, expect } from 'vitest';
import { Memory } from '../src/memory.js';
import { tmpWorkspace } from './helpers.js';

describe('Memory', () => {
  it('appends and persists conversation across instances', async () => {
    const dir = await tmpWorkspace();
    const a = new Memory(dir);
    await a.append({ role: 'user', content: 'hi' });
    await a.append({ role: 'assistant', content: 'hello' });
    expect(a.history()).toHaveLength(2);

    const b = new Memory(dir);
    await b.load();
    expect(b.history().map((m) => m.content)).toEqual(['hi', 'hello']);
  });

  it('clears history', async () => {
    const dir = await tmpWorkspace();
    const m = new Memory(dir);
    await m.append({ role: 'user', content: 'x' });
    await m.clear();
    expect(m.history()).toHaveLength(0);
  });

  it('caps persisted history length', async () => {
    const m = new Memory(await tmpWorkspace());
    for (let i = 0; i < 250; i++) await m.append({ role: 'user', content: String(i) });
    expect(m.history().length).toBeLessThanOrEqual(200);
    // keeps the most recent
    expect(m.history().at(-1)?.content).toBe('249');
  });
});
