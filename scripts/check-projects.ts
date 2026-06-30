/**
 * Validates projects + the PTY terminal without an LLM. Registry and projects
 * live inside .test-tmp (never $HOME). Writes result to .test-tmp/projects.txt.
 */
import { promises as fs, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../packages/server/src/index.js';
import type { UiEvent } from '../packages/shared/src/index.js';

async function main() {
  const base = path.resolve(process.cwd(), '.test-tmp', 'proj-' + randomUUID());
  const projectsRoot = path.join(base, 'projects');
  const registryPath = path.join(base, 'registry.json');
  await fs.mkdir(projectsRoot, { recursive: true });

  const server = await createServer({ projectsRoot, registryPath, port: 4795 });
  const out: string[] = [];
  const events: UiEvent[] = [];

  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
  const got = (pred: (e: UiEvent) => boolean, ms = 8000) =>
    new Promise<UiEvent>((resolve, reject) => {
      const found = events.find(pred);
      if (found) return resolve(found);
      const t = setTimeout(() => reject(new Error('timeout waiting for event')), ms);
      const h = (raw: WebSocket.RawData) => {
        const e = JSON.parse(raw.toString()) as UiEvent;
        events.push(e);
        if (pred(e)) {
          clearTimeout(t);
          ws.off('message', h);
          resolve(e);
        }
      };
      ws.on('message', h);
    });

  ws.on('message', (raw) => events.push(JSON.parse(raw.toString())));
  await new Promise<void>((r) => ws.on('open', () => r()));

  // 1) initial projects list (empty, no active)
  const proj0 = (await got((e) => e.type === 'projects')) as any;
  out.push(`initial projects: count=${proj0.projects.length} active=${proj0.active ?? 'none'} defaultRoot set=${Boolean(proj0.defaultRoot)}`);

  // 2) create a project → opens it (ready + active)
  ws.send(JSON.stringify({ type: 'create_project', name: 'My App' }));
  const ready = (await got((e) => e.type === 'ready')) as any;
  const onDisk = await fs
    .access(path.join(projectsRoot, 'my-app'))
    .then(() => true)
    .catch(() => false);
  out.push(`create+open: ready dir=${path.basename(ready.workspaceDir)} folderOnDisk=${onDisk}`);

  // 3) PTY terminal: type a command, expect the output echoed back
  ws.send(JSON.stringify({ type: 'term_input', data: 'echo PTYWORKS\r' }));
  const term = (await got((e) => e.type === 'term_data' && (e as any).data.includes('PTYWORKS'), 8000)) as any;
  out.push(`terminal (PTY): ${term ? 'OK — shell echoed/ran the command' : 'FAIL'}`);

  // 4) project now listed as active
  const projActive = [...events].reverse().find((e) => e.type === 'projects') as any;
  out.push(`active project: ${projActive?.active ? path.basename(projActive.active) : 'none'}`);

  out.push(`verdict: ${onDisk && term ? 'PASS' : 'CHECK'}`);
  writeFileSync('.test-tmp/projects.txt', out.join('\n') + '\n');

  ws.close();
  await server.close();
}

main().catch((e) => writeFileSync('.test-tmp/projects.txt', 'PROJECTS CHECK ERROR: ' + (e?.message ?? e)));
