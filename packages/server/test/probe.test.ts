import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { probeApp } from '../src/agent/probe.js';
import { tmpWorkspace } from './helpers.js';

const noEnv = async () => ({});

describe('probeApp', () => {
  it('reports no runnable app for an empty folder', async () => {
    const r = await probeApp(await tmpWorkspace(), noEnv, 4000);
    expect(r.ok).toBe(false);
    expect(r.logs).toMatch(/No runnable app/i);
  });

  it('refuses to run the OpenREPL folder itself', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'openrepl' }));
    const r = await probeApp(dir, noEnv, 4000);
    expect(r.ok).toBe(false);
    expect(r.logs).toMatch(/OpenREPL itself/i);
  });

  it('starts a static site and reports ok with a preview URL', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>PROBE-OK</h1>');
    const r = await probeApp(dir, noEnv, 6000);
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it('returns immediately (aborted) when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await probeApp(await tmpWorkspace(), noEnv, 4000, ctrl.signal);
    expect(r.ok).toBe(false);
    expect(r.logs).toMatch(/aborted/i);
  });
});
