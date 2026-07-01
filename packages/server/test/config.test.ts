import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { PROVIDER_DEFAULTS, modelFor, DEFAULT_CONFIG, dotDir, configPath } from '../src/config.js';

/**
 * Config contracts: provider-appropriate model defaults (so a provider switch
 * never sends a Claude alias to OpenRouter), role → model resolution, and the
 * ./.openrepl path helpers.
 */
describe('PROVIDER_DEFAULTS', () => {
  it('every provider has a model and a models map', () => {
    for (const p of ['claude', 'openrouter', 'codex'] as const) {
      expect(PROVIDER_DEFAULTS[p].model).toBeTruthy();
      expect(typeof PROVIDER_DEFAULTS[p].models).toBe('object');
    }
  });

  it('claude uses SDK aliases (opus for the coding orchestrator, haiku for planner)', () => {
    expect(PROVIDER_DEFAULTS.claude.model).toBe('sonnet');
    expect(PROVIDER_DEFAULTS.claude.models.orchestrator).toBe('opus');
    expect(PROVIDER_DEFAULTS.claude.models.planner).toBe('haiku');
  });

  it('openrouter uses namespaced provider/model ids (not bare SDK aliases)', () => {
    expect(PROVIDER_DEFAULTS.openrouter.model).toContain('/');
    for (const m of Object.values(PROVIDER_DEFAULTS.openrouter.models)) {
      expect(m).toContain('/');
    }
  });
});

describe('modelFor', () => {
  it('uses the per-role override when present, else the default model', () => {
    const cfg = { ...DEFAULT_CONFIG, model: 'default-model', models: { coder: 'coder-model' } };
    expect(modelFor(cfg, 'coder')).toBe('coder-model');
    expect(modelFor(cfg, 'planner')).toBe('default-model'); // no override → default
    expect(modelFor(cfg)).toBe('default-model');
  });
});

describe('path helpers', () => {
  it('resolve under the workspace .openrepl directory', () => {
    expect(dotDir('/w')).toBe(path.join('/w', '.openrepl'));
    expect(configPath('/w')).toBe(path.join('/w', '.openrepl', 'config.json'));
  });
});
