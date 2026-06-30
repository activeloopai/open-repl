import { describe, it, expect } from 'vitest';
import { Session } from '../src/session.js';
import { Memory } from '../src/memory.js';
import { tmpWorkspace } from './helpers.js';
import type { UiEvent } from '@openrepl/shared';

describe('Session (integration with demo provider)', () => {
  it('runs a full turn: agent writes a file, usage + memory are recorded', async () => {
    const dir = await tmpWorkspace();
    const events: UiEvent[] = [];
    const session = new Session(dir, (e) => events.push(e));
    try {
      await session.init();
      expect(events.some((e) => e.type === 'ready')).toBe(true);
      expect(events.some((e) => e.type === 'tree')).toBe(true);

      await session.handle({ type: 'send_message', text: 'create a file hello.js' });

      // file written
      expect(events.some((e) => e.type === 'agent_tool_call')).toBe(true);
      // usage + done
      expect(events.some((e) => e.type === 'usage_update')).toBe(true);
      expect(events.some((e) => e.type === 'done')).toBe(true);

      // memory persisted (user + assistant)
      const mem = new Memory(dir);
      await mem.load();
      expect(mem.history().length).toBeGreaterThanOrEqual(2);
      expect(mem.history()[0]).toMatchObject({ role: 'user', content: 'create a file hello.js' });
    } finally {
      await session.close();
    }
  });

  it('handles file open/save commands', async () => {
    const dir = await tmpWorkspace();
    const events: UiEvent[] = [];
    const session = new Session(dir, (e) => events.push(e));
    try {
      await session.init();
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
    const events: UiEvent[] = [];
    const session = new Session(dir, (e) => events.push(e));
    try {
      await session.init();
      await session.handle({ type: 'open_file', path: '../../etc/passwd' });
      expect(events.some((e) => e.type === 'error')).toBe(true);
    } finally {
      await session.close();
    }
  });
});
