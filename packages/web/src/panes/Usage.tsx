import { useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { store, useStore } from '../store.js';
import type { UsageRecord } from '@openrepl/shared';

export function Usage() {
  const usage = useStore((s) => s.usage);

  useEffect(() => {
    store.send({ type: 'get_usage' });
  }, []);

  const agg = useMemo(() => aggregate(usage), [usage]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(usage, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'openrepl-usage.json';
    a.click();
  };

  return (
    <div className="usage">
      <div className="usage-cards">
        <Card title="Total cost (USD)" value={`$${agg.totalUSD.toFixed(4)}`} hint="OpenRouter — real $" />
        <Card title="Plan units" value={String(agg.totalPlanUnits)} hint="Codex — flat sub, no $" />
        <Card title="Tokens in / out" value={`${agg.totalTokensIn} / ${agg.totalTokensOut}`} hint="all providers" />
        <Card title="Runs" value={String(usage.length)} hint="" />
      </div>

      <div className="usage-chart">
        <h4>Spend over time</h4>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={agg.timeline}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis dataKey="label" stroke="#888" fontSize={11} />
            <YAxis stroke="#888" fontSize={11} />
            <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d' }} />
            <Line type="monotone" dataKey="usd" stroke="#58a6ff" dot={false} name="USD" />
            <Line type="monotone" dataKey="units" stroke="#3fb950" dot={false} name="plan units" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <Breakdown title="By provider" rows={agg.byProvider} />
      <Breakdown title="By model" rows={agg.byModel} />

      <button className="export" onClick={exportJson}>
        Export JSON
      </button>
    </div>
  );
}

function Card({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="card-value">{value}</div>
      <div className="card-hint">{hint}</div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Record<string, Bucket> }) {
  const entries = Object.entries(rows);
  return (
    <div className="breakdown">
      <h4>{title}</h4>
      <table>
        <thead>
          <tr>
            <th>{title.includes('provider') ? 'Provider' : 'Model'}</th>
            <th>Runs</th>
            <th>Tokens in/out</th>
            <th>USD</th>
            <th>Units</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No runs yet.
              </td>
            </tr>
          )}
          {entries.map(([k, b]) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{b.runs}</td>
              <td>
                {b.tokensIn}/{b.tokensOut}
              </td>
              <td>${b.costUSD.toFixed(4)}</td>
              <td>{b.planUnits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Bucket {
  costUSD: number;
  planUnits: number;
  tokensIn: number;
  tokensOut: number;
  runs: number;
}

function aggregate(usage: UsageRecord[]) {
  const empty = (): Bucket => ({ costUSD: 0, planUnits: 0, tokensIn: 0, tokensOut: 0, runs: 0 });
  const byProvider: Record<string, Bucket> = {};
  const byModel: Record<string, Bucket> = {};
  let totalUSD = 0;
  let totalPlanUnits = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const sorted = [...usage].sort((a, b) => a.ts - b.ts);
  let cumUsd = 0;
  let cumUnits = 0;
  const timeline = sorted.map((r) => {
    cumUsd += r.costUSD ?? 0;
    cumUnits += r.planUnits ?? 0;
    return { label: new Date(r.ts).toLocaleTimeString(), usd: Number(cumUsd.toFixed(4)), units: cumUnits };
  });

  for (const r of usage) {
    const p = (byProvider[r.provider] ??= empty());
    const m = (byModel[r.model] ??= empty());
    for (const b of [p, m]) {
      b.costUSD += r.costUSD ?? 0;
      b.planUnits += r.planUnits ?? 0;
      b.tokensIn += r.tokensIn;
      b.tokensOut += r.tokensOut;
      b.runs += 1;
    }
    totalUSD += r.costUSD ?? 0;
    totalPlanUnits += r.planUnits ?? 0;
    totalTokensIn += r.tokensIn;
    totalTokensOut += r.tokensOut;
  }
  return { totalUSD, totalPlanUnits, totalTokensIn, totalTokensOut, byProvider, byModel, timeline };
}
