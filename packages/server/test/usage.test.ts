import { describe, it, expect } from 'vitest';
import { UsageStore, makeUsageRecord } from '../src/usage.js';
import { tmpWorkspace } from './helpers.js';

describe('UsageStore', () => {
  it('aggregates the two currencies ($ for OpenRouter, plan units for Codex) separately', async () => {
    const store = new UsageStore(await tmpWorkspace());
    await store.record(makeUsageRecord('r1', 'openrouter', 'gpt', 100, 50, 0.002, null, 1));
    await store.record(makeUsageRecord('r2', 'codex', 'gpt', 200, 80, null, 280, 2));

    const agg = await store.aggregate();
    expect(agg.totalUSD).toBeCloseTo(0.002);
    expect(agg.totalPlanUnits).toBe(280);
    expect(agg.totalTokensIn).toBe(300);
    expect(agg.byProvider.openrouter.costUSD).toBeCloseTo(0.002);
    expect(agg.byProvider.codex.planUnits).toBe(280);
    expect(agg.byProvider.codex.costUSD).toBe(0);
  });

  it('persists across instances', async () => {
    const dir = await tmpWorkspace();
    const a = new UsageStore(dir);
    await a.record(makeUsageRecord('r1', 'demo', 'x', 1, 1, 0, null, 1));
    const b = new UsageStore(dir);
    expect(await b.all()).toHaveLength(1);
  });
});
