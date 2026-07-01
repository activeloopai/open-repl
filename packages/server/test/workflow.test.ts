import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { detectWorkflows, WorkflowManager } from '../src/workflow.js';
import { tmpWorkspace } from './helpers.js';

/** Write files into a fresh workspace and return its path. */
async function ws(files: Record<string, string>): Promise<string> {
  const dir = await tmpWorkspace();
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return dir;
}
const pkg = (o: unknown) => JSON.stringify(o);

describe('detectWorkflows', () => {
  it('empty folder → no runnable app', async () => {
    const d = await detectWorkflows(await tmpWorkspace());
    expect(d).toMatchObject({ self: false, install: null, workflows: [] });
  });

  it('recognizes OpenREPL itself (never runs it as a user app)', async () => {
    const d = await detectWorkflows(await ws({ 'package.json': pkg({ name: 'openrepl-monorepo' }) }));
    expect(d.self).toBe(true);
  });

  it('node: single dev script → one preview step, install when node_modules missing', async () => {
    const d = await detectWorkflows(await ws({ 'package.json': pkg({ name: 'app', scripts: { dev: 'vite' } }) }));
    expect(d.install).toBe('npm install');
    expect(d.workflows[0].steps[0]).toMatchObject({ command: 'npm run dev', preview: true });
  });

  it('node: falls back to start when there is no dev script', async () => {
    const d = await detectWorkflows(await ws({ 'package.json': pkg({ name: 'app', scripts: { start: 'node .' } }) }));
    expect(d.workflows[0].steps[0].command).toBe('npm start');
  });

  it('node: backend + frontend scripts → two steps, frontend previews', async () => {
    const d = await detectWorkflows(await ws({ 'package.json': pkg({ name: 'app', scripts: { server: 'node api', web: 'vite' } }) }));
    const steps = d.workflows[0].steps;
    expect(steps.map((s) => s.name)).toEqual(['backend', 'frontend']);
    expect(steps[1].preview).toBe(true);
  });

  it('node: no install command when node_modules already exists', async () => {
    const d = await detectWorkflows(
      await ws({ 'package.json': pkg({ name: 'app', scripts: { dev: 'vite' } }), 'node_modules/.keep': '' }),
    );
    expect(d.install).toBeNull();
  });

  it('python: app.py with no requirements → system python3, no install', async () => {
    const d = await detectWorkflows(await ws({ 'app.py': 'print(1)' }));
    expect(d.workflows[0].steps[0].command).toBe('python3 app.py');
    expect(d.install).toBeNull();
  });

  it('python: requirements.txt + app.py → managed venv install and venv python', async () => {
    const d = await detectWorkflows(await ws({ 'app.py': 'print(1)', 'requirements.txt': 'flask' }));
    expect(d.install).toContain('python3 -m venv .venv');
    expect(d.workflows[0].steps[0].command).toBe('.venv/bin/python app.py');
  });

  it('python: manage.py → django runserver', async () => {
    const d = await detectWorkflows(await ws({ 'manage.py': '' }));
    expect(d.workflows[0].steps[0].command).toContain('manage.py runserver');
  });

  it('static: index.html → a static site step', async () => {
    const d = await detectWorkflows(await ws({ 'index.html': '<h1>hi</h1>' }));
    expect(d.workflows[0]).toMatchObject({ name: 'Static' });
    expect(d.workflows[0].steps[0]).toMatchObject({ static: true, preview: true });
  });

  it('honors a user-defined .openrepl/workflows.json override', async () => {
    const d = await detectWorkflows(
      await ws({ '.openrepl/workflows.json': pkg({ workflows: [{ name: 'Custom', steps: [{ name: 'x', command: 'echo hi' }] }] }) }),
    );
    expect(d.workflows[0].name).toBe('Custom');
  });
});

describe('WorkflowManager (static site)', () => {
  it('serves a static workflow, reports a preview port, and stops cleanly', async () => {
    const dir = await ws({ 'index.html': '<h1>MANAGED</h1>' });
    let previewPort = 0;
    const mgr = new WorkflowManager(dir, async () => ({}), () => {}, (port) => (previewPort = port), () => {});
    await mgr.start({ name: 'Static', steps: [{ name: 'site', static: true, preview: true }] });
    expect(mgr.running()).toBe(true);
    expect(previewPort).toBeGreaterThan(0);
    const res = await fetch(`http://localhost:${previewPort}/`);
    expect(await res.text()).toContain('MANAGED');
    await mgr.stop();
    expect(mgr.running()).toBe(false);
  });
});
