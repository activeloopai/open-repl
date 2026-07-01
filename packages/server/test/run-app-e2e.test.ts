import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../src/index.js';
import { tmpWorkspace } from './helpers.js';
import type { UiEvent } from '@openrepl/shared';

/**
 * True end-to-end: a non-technical user clicks "Run app" on a static site and
 * the Preview proxy serves it — exercising run_app → static server → preview proxy.
 */
describe('Run app (static) end-to-end through the preview proxy', () => {
  it('serves the user app at /__preview after run_app', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><h1>MY-APP-LIVE</h1>');

    // Omit port so createServer's findFreePort picks a free one (collision-safe
    // under parallel runs); server.url reflects the actual bound port.
    const server = await createServer({
      initialProject: dir,
      registryPath: path.join(dir, 'projects.json'),
      projectsRoot: dir,
    });
    const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for app running')), 20000);
        ws.on('message', (raw) => {
          const e = JSON.parse(raw.toString()) as UiEvent;
          // Wait for the project to be mounted (ready) before asking it to run —
          // the server mounts the initialProject asynchronously on connect.
          if (e.type === 'ready') ws.send(JSON.stringify({ type: 'run_app' }));
          if (e.type === 'app_status' && e.state === 'running') {
            clearTimeout(t);
            resolve();
          }
          if (e.type === 'app_status' && e.state === 'error') {
            clearTimeout(t);
            reject(new Error(e.message));
          }
        });
        ws.on('error', reject);
      });

      const res = await fetch(server.url + '/__preview/');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('MY-APP-LIVE');
    } finally {
      ws.close();
      await server.close();
    }
  }, 30000);
});
