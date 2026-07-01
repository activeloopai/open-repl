import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Session } from '../src/session.js';
import { ProjectRegistry } from '../src/projects.js';
import { tmpWorkspace } from './helpers.js';
import type { UiEvent } from '@openrepl/shared';

/**
 * Session covers the provider-independent WS surface (projects, files, model /
 * provider / secrets config, workflows, run_app, errors). The full agent turn
 * (send_message) needs a real Claude credential and lives in
 * scripts/check-claude-engine.ts.
 */
function makeSession(dir: string) {
  const events: UiEvent[] = [];
  const projects = new ProjectRegistry(path.join(dir, 'projects.json'), dir);
  const session = new Session((e) => events.push(e), projects);
  return { session, events };
}
async function opened(dir: string) {
  const { session, events } = makeSession(dir);
  await session.init();
  await session.handle({ type: 'open_project', path: dir });
  return { session, events };
}
const last = <T extends UiEvent['type']>(events: UiEvent[], t: T) =>
  [...events].reverse().find((e) => e.type === t) as Extract<UiEvent, { type: T }> | undefined;

describe('Session — projects & files', () => {
  it('open_project emits ready, tree, secrets, model_config, workflows', async () => {
    const { events } = await opened(await tmpWorkspace());
    for (const t of ['ready', 'tree', 'secrets', 'model_config', 'workflows'] as const) {
      expect(events.some((e) => e.type === t)).toBe(true);
    }
  });

  it('create_project opens the created folder', async () => {
    const root = await tmpWorkspace();
    const { session, events } = makeSession(root);
    try {
      await session.init();
      await session.handle({ type: 'create_project', name: 'demo', path: path.join(root, 'demo') });
      expect(last(events, 'ready')?.workspaceDir).toContain('demo');
    } finally {
      await session.close();
    }
  });

  it('list_tree, save_file and open_file round-trip', async () => {
    const { session, events } = await opened(await tmpWorkspace());
    try {
      await session.handle({ type: 'save_file', path: 'note.txt', content: 'persisted' });
      await session.handle({ type: 'list_tree' });
      expect(last(events, 'tree')).toBeTruthy();
      await session.handle({ type: 'open_file', path: 'note.txt' });
      expect(last(events, 'file_content')).toMatchObject({ path: 'note.txt', content: 'persisted' });
    } finally {
      await session.close();
    }
  });

  it('reports an error for a path escaping the workspace', async () => {
    const { session, events } = await opened(await tmpWorkspace());
    try {
      await session.handle({ type: 'open_file', path: '../../etc/passwd' });
      expect(events.some((e) => e.type === 'error')).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('rejects commands before a project is open', async () => {
    const { session, events } = makeSession(await tmpWorkspace());
    try {
      await session.init(); // no projects registered → nothing auto-opens
      await session.handle({ type: 'list_tree' });
      expect(last(events, 'error')?.message).toMatch(/no project/i);
    } finally {
      await session.close();
    }
  });
});

describe('Session — model / provider / secrets config', () => {
  it('set_model (default + per-role) updates the model_config', async () => {
    const { session, events } = await opened(await tmpWorkspace());
    try {
      await session.handle({ type: 'set_model', role: 'default', model: 'sonnet' });
      await session.handle({ type: 'set_model', role: 'coder', model: 'opus' });
      const cfg = last(events, 'model_config');
      expect(cfg?.default).toBe('sonnet');
      expect(cfg?.roles?.coder).toBe('opus');
    } finally {
      await session.close();
    }
  });

  it('set_multi_agent toggles the flag', async () => {
    const { session, events } = await opened(await tmpWorkspace());
    try {
      await session.handle({ type: 'set_multi_agent', enabled: false });
      expect(last(events, 'model_config')?.multiAgent).toBe(false);
    } finally {
      await session.close();
    }
  });

  it('switching provider emits provider_status and a models list', async () => {
    const { session, events } = await opened(await tmpWorkspace());
    try {
      await session.handle({ type: 'set_provider', provider: 'codex' }); // static models, no network
      expect(last(events, 'provider_status')?.provider).toBe('codex');
      expect((last(events, 'models')?.models.length ?? 0)).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });

  it('secrets: set → list → delete', async () => {
    const { session, events } = await opened(await tmpWorkspace());
    try {
      await session.handle({ type: 'set_secret', key: 'FOO', value: 'bar' });
      expect(last(events, 'secrets')?.keys).toContain('FOO');
      await session.handle({ type: 'delete_secret', key: 'FOO' });
      expect(last(events, 'secrets')?.keys).not.toContain('FOO');
    } finally {
      await session.close();
    }
  });
});

describe('Session — workflows & run', () => {
  it('list_workflows detects a static site', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>hi</h1>');
    const { session, events } = await opened(dir);
    try {
      await session.handle({ type: 'list_workflows' });
      expect((last(events, 'workflows')?.workflows.length ?? 0)).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  });

  it('run_app on an empty project reports an app_status error', async () => {
    const { session, events } = await opened(await tmpWorkspace());
    try {
      await session.handle({ type: 'run_app' });
      const s = last(events, 'app_status');
      expect(s?.state).toBe('error');
    } finally {
      await session.close();
    }
  });

  it('stop is a safe no-op when nothing is running', async () => {
    const { session } = await opened(await tmpWorkspace());
    try {
      await expect(session.handle({ type: 'stop' })).resolves.toBeUndefined();
    } finally {
      await session.close();
    }
  });
});

describe('Session — shell & running an app', () => {
  it('run_command streams terminal output', async () => {
    const { session, events } = await opened(await tmpWorkspace());
    try {
      await session.handle({ type: 'run_command', command: 'echo term-probe' });
      expect(events.some((e) => e.type === 'term_data')).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('run_app on a static site goes running, then stop_app stops it', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>run</h1>');
    const { session, events } = await opened(dir);
    try {
      await session.handle({ type: 'run_app' });
      expect(last(events, 'app_status')?.state).toBe('running');
      await session.handle({ type: 'stop_app' });
      expect(last(events, 'app_status')?.state).toBe('stopped');
    } finally {
      await session.close();
    }
  });
});
