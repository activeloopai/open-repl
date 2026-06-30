import { useEffect } from 'react';
import { store, useStore } from '../store.js';
import type { AgentRole, ModelInfo } from '@openrepl/shared';

const ROLES: { role: AgentRole; label: string; hint: string }[] = [
  { role: 'default', label: 'Default', hint: 'Fallback for any role without its own model' },
  { role: 'orchestrator', label: 'Orchestrator', hint: 'Reasoning / planning the delegations' },
  { role: 'planner', label: 'Planner', hint: 'Breaks the task into steps (read-only)' },
  { role: 'coder', label: 'Coder', hint: 'Writes & edits code' },
  { role: 'reviewer', label: 'Reviewer / Tester', hint: 'Reviews and runs tests' },
];

export function Models() {
  const models = useStore((s) => s.models);
  const cfg = useStore((s) => s.modelConfig);
  const provider = useStore((s) => s.provider);

  useEffect(() => {
    store.send({ type: 'list_models' });
  }, [provider]);

  const valueFor = (role: AgentRole) => (role === 'default' ? cfg.default : cfg.roles[role] ?? '');

  return (
    <div className="models-pane">
      <div className="models-head">
        <label className="multi-toggle">
          <input
            type="checkbox"
            checked={cfg.multiAgent}
            onChange={(e) => store.send({ type: 'set_multi_agent', enabled: e.target.checked })}
          />
          Multi-agent (orchestrator → planner / coder / reviewer)
        </label>
        <span className="muted">{models.length} models · provider: {provider}</span>
      </div>

      {!cfg.multiAgent && <p className="muted">Multi-agent is off — only the Default model is used (single agent).</p>}

      <datalist id="model-list">
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {priceLabel(m)}
          </option>
        ))}
      </datalist>

      <div className="model-rows">
        {ROLES.filter((r) => cfg.multiAgent || r.role === 'default').map(({ role, label, hint }) => (
          <div className="model-row" key={role}>
            <div className="model-label">
              <strong>{label}</strong>
              <span className="muted">{hint}</span>
            </div>
            <input
              list="model-list"
              className="model-input"
              placeholder={role === 'default' ? 'pick a model…' : `(inherits default: ${cfg.default || '—'})`}
              defaultValue={valueFor(role)}
              key={valueFor(role)}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== valueFor(role)) store.send({ type: 'set_model', role, model: v });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="model-price">{priceFor(models, valueFor(role))}</span>
          </div>
        ))}
      </div>

      <p className="muted small">
        Tip: cheap model for Planner/Reviewer, strong model for Orchestrator/Coder. Type to search; prices are USD / 1M tokens.
      </p>
    </div>
  );
}

function priceLabel(m: ModelInfo): string {
  if (m.promptUsdPerM == null) return m.name;
  return `${m.name} — $${m.promptUsdPerM}/$${m.completionUsdPerM ?? '?'} per 1M`;
}

function priceFor(models: ModelInfo[], id: string): string {
  const m = models.find((x) => x.id === id);
  if (!m || m.promptUsdPerM == null) return '';
  return `$${m.promptUsdPerM} / $${m.completionUsdPerM ?? '?'}`;
}
