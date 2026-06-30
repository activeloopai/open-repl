import { promises as fs } from 'node:fs';
import path from 'node:path';
import { dotDir } from './config.js';
import type { UsageRecord, ProviderId } from '@openrepl/shared';

/**
 * Usage/cost store. Records one row per run. Handles the two "currencies":
 *   - OpenRouter -> real costUSD
 *   - Codex (flat sub) -> planUnits (no $)
 * The dashboard reads aggregates from here.
 */
export class UsageStore {
  private file: string;
  private records: UsageRecord[] = [];
  private loaded = false;

  constructor(workspaceDir: string) {
    this.file = path.join(dotDir(workspaceDir), 'usage.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.records = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      this.records = [];
    }
    this.loaded = true;
  }

  async record(r: UsageRecord): Promise<void> {
    await this.load();
    this.records.push(r);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.records, null, 2));
  }

  async all(): Promise<UsageRecord[]> {
    await this.load();
    return this.records;
  }

  async aggregate(): Promise<{
    totalUSD: number;
    totalPlanUnits: number;
    totalTokensIn: number;
    totalTokensOut: number;
    byProvider: Record<string, { costUSD: number; planUnits: number; tokensIn: number; tokensOut: number; runs: number }>;
    byModel: Record<string, { costUSD: number; planUnits: number; tokensIn: number; tokensOut: number; runs: number }>;
    records: UsageRecord[];
  }> {
    await this.load();
    const empty = () => ({ costUSD: 0, planUnits: 0, tokensIn: 0, tokensOut: 0, runs: 0 });
    const byProvider: Record<string, ReturnType<typeof empty>> = {};
    const byModel: Record<string, ReturnType<typeof empty>> = {};
    let totalUSD = 0;
    let totalPlanUnits = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (const r of this.records) {
      const p = (byProvider[r.provider] ??= empty());
      const m = (byModel[r.model] ??= empty());
      const usd = r.costUSD ?? 0;
      const units = r.planUnits ?? 0;
      for (const bucket of [p, m]) {
        bucket.costUSD += usd;
        bucket.planUnits += units;
        bucket.tokensIn += r.tokensIn;
        bucket.tokensOut += r.tokensOut;
        bucket.runs += 1;
      }
      totalUSD += usd;
      totalPlanUnits += units;
      totalTokensIn += r.tokensIn;
      totalTokensOut += r.tokensOut;
    }

    return { totalUSD, totalPlanUnits, totalTokensIn, totalTokensOut, byProvider, byModel, records: this.records };
  }
}

export function makeUsageRecord(
  runId: string,
  provider: ProviderId,
  model: string,
  tokensIn: number,
  tokensOut: number,
  costUSD: number | null,
  planUnits: number | null,
  ts: number,
): UsageRecord {
  return { runId, provider, model, tokensIn, tokensOut, costUSD, planUnits, ts };
}
