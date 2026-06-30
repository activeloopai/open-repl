import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { Session } from '../src/session.js';
import { ProjectRegistry } from '../src/projects.js';
import { tmpWorkspace } from './helpers.js';
import type { UiEvent } from '@openrepl/shared';

/**
 * Session integration tests for the provider-independent surface (project
 * open, file open/save, path-escape errors). The full agent turn used to be
 * covered here via the offline demo provider; that provider was removed, so the
 * end-to-end agent flow now lives in scripts/check-claude-engine.ts (real
 * Claude credential required).
 */
function makeSession(dir: string) {
  const events: UiEvent[] = [];
  const projects = new ProjectRegistry(path.join(dir, 'projects.json'), dir);
  const session = new Session((e) => events.push(e), projects);
  return { session, events };
}

describe('Session', () => {
  it('opening a project emits ready + tree', async () => {
    const dir = await tmpWorkspace();
    const { session, events } = makeSession(dir);
    try {
      await session.init();
      await session.handle({ type: 'open_project', path: dir });
      expect(events.some((e) => e.type === 'ready')).toBe(true);
      expect(events.some((e) => e.type === 'tree')).toBe(true);
    } finally {
      await session.close();
    }
  });

  it('handles file open/save commands', async () => {
    const dir = await tmpWorkspace();
    const { session, events } = makeSession(dir);
    try {
      await session.init();
      await session.handle({ type: 'open_project', path: dir });
      await session.handle({ type: 'save_file', path: 'note.txt', content: 'persisted' });
      await session.handle({ type: 'open_file', path: 'note.txt' });
      const content = events.find((e) => e.type === 'file_content');
      expect(content).toMatchObject({ type: 'file_content', path: 'note.txt', content: 'persisted' });
    } finally {
      await session.close();
    }
  });

  it('reports an error event for an out-of-workspace path instead of throwing', async () => {
    const dir = await tmpWorkspace();
    const { session, events } = makeSession(dir);
    try {
      await session.init();
      await session.handle({ type: 'open_project', path: dir });
      await session.handle({ type: 'open_file', path: '../../etc/passwd' });
      expect(events.some((e) => e.type === 'error')).toBe(true);
    } finally {
      await session.close();
    }
  });
});
