import { describe, it, expect, vi, afterEach } from 'vitest';
import { listModels } from '../src/providers/models.js';
import { modelFor, DEFAULT_CONFIG } from '../src/config.js';

afterEach(() => vi.unstubAllGlobals());

describe('listModels', () => {
  it('keeps only tool-calling OpenRouter models and converts pricing to $/1M', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'a/tools', name: 'A', supported_parameters: ['tools'], pricing: { prompt: '0.000001', completion: '0.000002' } },
              { id: 'b/notools', name: 'B', supported_parameters: ['temperature'], pricing: { prompt: '0', completion: '0' } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const models = await listModels('openrouter');
    expect(models.map((m) => m.id)).toEqual(['a/tools']);
    expect(models[0].promptUsdPerM).toBeCloseTo(1);
    expect(models[0].completionUsdPerM).toBeCloseTo(2);
  });

  it('falls back to a static list when the catalog fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const models = await listModels('openrouter');
    expect(models.length).toBeGreaterThan(0);
  });

  it('returns the exact static catalog for codex', async () => {
    expect(await listModels('codex')).toEqual([
      { id: 'gpt-5.1', name: 'GPT-5.1' },
      { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex' },
      { id: 'gpt-5-mini', name: 'GPT-5 mini' },
      { id: 'o4-mini', name: 'o4-mini' },
    ]);
  });

  it('returns the exact static catalog for claude (SDK aliases)', async () => {
    expect(await listModels('claude')).toEqual([
      { id: 'haiku', name: 'Claude Haiku (cheap)' },
      { id: 'sonnet', name: 'Claude Sonnet (balanced)' },
      { id: 'opus', name: 'Claude Opus (strong)' },
      { id: 'fable', name: 'Claude Fable (max)' },
    ]);
  });
});

describe('modelFor', () => {
  it('uses the role override when present, else the default', () => {
    const cfg = { ...DEFAULT_CONFIG, model: 'default-model', models: { coder: 'coder-model' } };
    expect(modelFor(cfg, 'coder')).toBe('coder-model');
    expect(modelFor(cfg, 'planner')).toBe('default-model');
    expect(modelFor(cfg)).toBe('default-model');
  });
});
