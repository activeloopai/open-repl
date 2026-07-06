import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppHub } from '../src/app-hub.js';
import type { UiEvent } from '@openrepl/shared';
import { tmpWorkspace } from './helpers.js';

/**
 * The hub owns the running app per workspace, shared across sessions. These
 * cover the bug the per-session model caused: a second tab / reconnect couldn't
 * see the running app or stop it.
 */
describe('AppHub', () => {
  const status = (events: Array<[string, UiEvent]>) =>
    [...events].reverse().find(([, e]) => e.type === 'app_status')?.[1] as
      | Extract<UiEvent, { type: 'app_status' }>
      | undefined;

  it('broadcasts a running app to every subscriber, and either can stop it', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>hi</h1>');
    const hub = new AppHub();
    const a: Array<[string, UiEvent]> = [];
    const b: Array<[string, UiEvent]> = [];
    hub.subscribe((d, e) => a.push([d, e]));
    hub.subscribe((d, e) => b.push([d, e]));

    await hub.run(dir, async () => ({}));
    // Both "tabs" see the app running and the shared preview has a port.
    expect(status(a)?.state).toBe('running');
    expect(status(b)?.state).toBe('running');
    expect(hub.preview(dir)?.getPort()).not.toBeNull();

    // The *second* subscriber stops it — proving Stop is not tied to the tab
    // that started it. Both see 'stopped' and the app is gone.
    await hub.stop(dir);
    expect(status(a)?.state).toBe('stopped');
    expect(status(b)?.state).toBe('stopped');
    expect(await hub.preview(dir)!.isUp()).toBe(false);
  });

  it('reports an error status for a folder with nothing runnable', async () => {
    const dir = await tmpWorkspace();
    const hub = new AppHub();
    const seen: Array<[string, UiEvent]> = [];
    hub.subscribe((d, e) => seen.push([d, e]));
    await hub.run(dir, async () => ({}));
    expect(status(seen)?.state).toBe('error');
  });

  it('notePort surfaces a terminal-started dev server as a preview', () => {
    const hub = new AppHub();
    const seen: Array<[string, UiEvent]> = [];
    hub.subscribe((d, e) => seen.push([d, e]));
    hub.notePort('/ws', 5173);
    expect(hub.preview('/ws')?.getPort()).toBe(5173);
    expect(seen.some(([, e]) => e.type === 'preview_ready')).toBe(true);
  });
});
