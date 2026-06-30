/**
 * Manual validation (not the vitest suite) of the post-migration paths that
 * don't need an LLM key: onboarding nudge, static Run app, and the anti-self
 * recursion guard. Writes result to .test-tmp/check.txt.
 */
import { promises as fs, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../packages/server/src/index.js';
import type { UiEvent } from '../packages/shared/src/index.js';

const out: string[] = [];
const log = (s: string) => out.push(s);

function drive(url: string, send: object, until: (e: UiEvent) => boolean, timeoutMs = 12000): Promise<UiEvent[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
    const events: UiEvent[] = [];
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(send)));
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString()) as UiEvent;
      events.push(e);
      if (until(e)) {
        clearTimeout(t);
        ws.close();
        resolve(events);
      }
    });
    ws.on('error', reject);
  });
}

async function main() {
  const ws1 = path.resolve(process.cwd(), '.test-tmp', 'mig-' + randomUUID());
  await fs.mkdir(ws1, { recursive: true });

  // 1) onboarding: send a message with no key → provider error + done
  const s1 = await createServer({ workspaceDir: ws1, port: 4760 });
  const ev1 = await drive(s1.url, { type: 'send_message', text: 'hello' }, (e) => e.type === 'done');
  const onboarding = ev1.find((e) => e.type === 'error' && e.scope === 'provider');
  log(`onboarding nudge (no key): ${onboarding ? 'OK — ' + (onboarding as any).message.slice(0, 40) : 'MISSING'}`);
  await s1.close();

  // 2) static Run app
  await fs.writeFile(path.join(ws1, 'index.html'), '<h1>MIG-APP</h1>');
  const s2 = await createServer({ workspaceDir: ws1, port: 4761 });
  await drive(s2.url, { type: 'run_app' }, (e) => e.type === 'app_status' && (e.state === 'running' || e.state === 'error'));
  const body = await (await fetch(s2.url + '/__preview/')).text();
  log(`static Run app: ${body.includes('MIG-APP') ? 'OK — preview serves the app' : 'FAIL'}`);
  await s2.close();

  // 3) anti-self guard: run_app on the OpenREPL repo itself → error 'self'
  const s3 = await createServer({ workspaceDir: process.cwd(), port: 4762 });
  const ev3 = await drive(s3.url, { type: 'run_app' }, (e) => e.type === 'app_status' && e.state === 'error');
  const self = ev3.find((e) => e.type === 'app_status' && e.state === 'error');
  log(`anti-self guard (Run on OpenREPL repo): ${self && /OpenREPL folder/.test((self as any).message) ? 'OK — refused with guidance' : 'FAIL'}`);
  await s3.close();

  writeFileSync('.test-tmp/check.txt', out.join('\n') + '\n');
}

main().catch((e) => {
  writeFileSync('.test-tmp/check.txt', 'CHECK ERROR: ' + e.message + '\n' + out.join('\n'));
});
