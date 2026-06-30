/**
 * Real e2e on the user's actual Flask project (TEST1): open it, Run, and check
 * the Preview serves the running app. Creates a .venv inside the project (kept).
 * Writes result to .test-tmp/flask.txt.
 */
import { promises as fs, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../packages/server/src/index.js';
import type { UiEvent } from '../packages/shared/src/index.js';

async function main() {
  const project = path.join(os.homedir(), 'openrepl-projects', 'test1');
  const base = path.resolve(process.cwd(), '.test-tmp', 'flask-' + randomUUID());
  await fs.mkdir(base, { recursive: true });

  const server = await createServer({ projectsRoot: path.join(base, 'p'), registryPath: path.join(base, 'r.json'), port: 4796 });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
  const statuses: string[] = [];

  await new Promise<void>((resolve) => ws.on('open', () => resolve()));
  ws.send(JSON.stringify({ type: 'open_project', path: project }));

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout (120s) — statuses: ' + statuses.join(' → '))), 120000);
    let opened = false;
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString()) as UiEvent;
      if (e.type === 'ready' && !opened) {
        opened = true;
        ws.send(JSON.stringify({ type: 'run_workflow' }));
      }
      if (e.type === 'app_status') {
        statuses.push(e.state + (e.message ? `(${e.message.slice(0, 40)})` : ''));
        if (e.state === 'running') {
          clearTimeout(t);
          resolve();
        }
        if (e.state === 'error') {
          clearTimeout(t);
          reject(new Error('app_status error: ' + e.message));
        }
      }
    });
  });

  // give Flask a moment to be ready, then hit the preview
  await new Promise((r) => setTimeout(r, 1500));
  const res = await fetch(server.url + '/__preview/');
  const body = await res.text();
  const ok = res.status === 200 && /<(html|!doctype|body|h1|table|form)/i.test(body);

  writeFileSync(
    '.test-tmp/flask.txt',
    [`statuses: ${statuses.join(' → ')}`, `preview HTTP ${res.status}, ${body.length} bytes`, `looks like an HTML app: ${ok}`, `verdict: ${ok ? 'PASS — Flask app runs in Preview' : 'CHECK'}`].join('\n') + '\n',
  );

  ws.send(JSON.stringify({ type: 'stop_app' }));
  await new Promise((r) => setTimeout(r, 500));
  ws.close();
  await server.close();
}

main().catch((e) => writeFileSync('.test-tmp/flask.txt', 'FLASK CHECK ERROR: ' + (e?.message ?? e)));
