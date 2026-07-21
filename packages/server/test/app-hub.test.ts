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

  it('stop clears the preview port so the proxy stops pointing at a dead server', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>hi</h1>');
    const hub = new AppHub();
    hub.subscribe(() => {});
    await hub.run(dir, async () => ({}));
    expect(hub.runningPreview()).not.toBeNull(); // a running app is proxied
    await hub.stop(dir);
    // The bug (intermittent 502): a stale port kept runningPreview() returning a
    // stopped workspace. After the fix the port is cleared.
    expect(hub.preview(dir)?.getPort()).toBeNull();
    expect(hub.runningPreview()).toBeNull();
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

  it('runningPreview ignores a stopped workspace and returns the running one', async () => {
    const a = await tmpWorkspace();
    const b = await tmpWorkspace();
    await fs.writeFile(path.join(a, 'index.html'), '<h1>a</h1>');
    await fs.writeFile(path.join(b, 'index.html'), '<h1>b</h1>');
    const hub = new AppHub();
    hub.subscribe(() => {});
    await hub.run(a, async () => ({}));
    await hub.run(b, async () => ({}));
    const bPort = hub.preview(b)!.getPort();
    await hub.stop(a); // a is stopped; b still runs
    expect(hub.runningPreview()?.getPort()).toBe(bPort);
    await hub.stop(b);
  });

  it('restarting an app re-broadcasts preview_ready (iframe refreshes)', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>hi</h1>');
    const hub = new AppHub();
    let readies = 0;
    hub.subscribe((_d, e) => { if (e.type === 'preview_ready') readies++; });
    await hub.run(dir, async () => ({}));
    await hub.stop(dir);
    await hub.run(dir, async () => ({}));
    await hub.stop(dir);
    expect(readies).toBe(2); // one per start — the stale-port fix re-emits on restart
  });

  it('detach stops the app only when the last session for a dir leaves', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>hi</h1>');
    const hub = new AppHub();
    hub.subscribe(() => {});
    hub.attach(dir);
    hub.attach(dir); // two tabs open this workspace
    await hub.run(dir, async () => ({}));
    hub.detach(dir); // one tab leaves — app keeps running
    expect(hub.runningPreview()).not.toBeNull();
    hub.detach(dir); // last tab leaves — app is stopped (no orphaned server)
    await new Promise((r) => setTimeout(r, 200)); // detach fires stop() async
    expect(hub.runningPreview()).toBeNull();
  });
});
