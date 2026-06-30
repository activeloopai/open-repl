/**
 * Validates the workflow feature without an LLM: a fake full-stack app
 * (backend + frontend scripts) → detect "Dev" workflow → run both processes →
 * preview points at the frontend. Writes result to .test-tmp/workflow.txt.
 */
import { promises as fs, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../packages/server/src/index.js';
import { detectWorkflows } from '../packages/server/src/workflow.js';
import type { UiEvent } from '../packages/shared/src/index.js';

async function main() {
  const ws1 = path.resolve(process.cwd(), '.test-tmp', 'wf-' + randomUUID());
  await fs.mkdir(path.join(ws1, 'node_modules'), { recursive: true }); // skip npm install
  await fs.writeFile(path.join(ws1, 'package.json'), JSON.stringify({ name: 'fake-app', scripts: { server: 'node server.js', web: 'node web.js' } }));
  await fs.writeFile(path.join(ws1, 'server.js'), `require('http').createServer((q,r)=>r.end('BE')).listen(4782,()=>console.log('backend on 4782'));`);
  await fs.writeFile(path.join(ws1, 'web.js'), `require('http').createServer((q,r)=>r.end('WF-FE-OK')).listen(4781,()=>console.log('Local: http://localhost:4781/'));`);

  const out: string[] = [];

  // 1) detection
  const det = await detectWorkflows(ws1);
  const dev = det.workflows.find((w) => w.name === 'Dev');
  out.push(`detect: ${dev ? 'Dev = ' + dev.steps.map((s) => `${s.name}${s.preview ? '*' : ''}`).join(' + ') : 'MISSING'} (needsInstall=${det.needsInstall})`);

  // 2) run it
  const server = await createServer({ workspaceDir: ws1, port: 4790 });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 15000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'run_workflow', name: 'Dev' })));
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString()) as UiEvent;
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

  const body = await (await fetch(server.url + '/__preview/')).text();
  out.push(`run: preview serves frontend = ${body.includes('WF-FE-OK') ? 'OK' : 'FAIL (' + body.slice(0, 30) + ')'}`);

  ws.send(JSON.stringify({ type: 'stop_app' }));
  await new Promise((r) => setTimeout(r, 300));
  ws.close();
  await server.close();
  out.push(`verdict: ${dev && body.includes('WF-FE-OK') ? 'PASS' : 'CHECK'}`);
  writeFileSync('.test-tmp/workflow.txt', out.join('\n') + '\n');
}

main().catch((e) => writeFileSync('.test-tmp/workflow.txt', 'WORKFLOW CHECK ERROR: ' + (e?.message ?? e)));
