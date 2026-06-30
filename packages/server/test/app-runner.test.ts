import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { detectRunPlan } from '../src/app-runner.js';
import { startStaticServer } from '../src/static-server.js';
import { tmpWorkspace } from './helpers.js';

describe('detectRunPlan', () => {
  it('detects an npm dev script', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    const plan = await detectRunPlan(dir);
    expect(plan.kind).toBe('npm-dev');
    expect(plan.command).toBe('npm run dev');
    expect(plan.needsInstall).toBe(true); // no node_modules
  });

  it('falls back to start script', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
    expect((await detectRunPlan(dir)).kind).toBe('npm-start');
  });

  it('detects a static index.html', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>hi</h1>');
    expect((await detectRunPlan(dir)).kind).toBe('static');
  });

  it('reports none when nothing is runnable', async () => {
    expect((await detectRunPlan(await tmpWorkspace())).kind).toBe('none');
  });
});

describe('startStaticServer', () => {
  it('serves index.html', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>STATIC-OK</h1>');
    const server = await startStaticServer(dir);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('STATIC-OK');
    } finally {
      await server.close();
    }
  });
});
