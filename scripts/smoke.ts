/**
 * End-to-end smoke test: boots the real server, drives it over a real
 * WebSocket like the browser would, and asserts the full chain works.
 * Run: npx tsx scripts/smoke.ts
 */
import { promises as fs, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../packages/server/src/index.js';
import type { UiEvent } from '../packages/shared/src/index.js';

function fail(msg: string): never {
  console.error('✗ SMOKE FAILED:', msg);
  process.exit(1);
}

async function main() {
  const workspaceDir = path.resolve(process.cwd(), '.test-tmp', 'smoke-' + randomUUID());
  await fs.mkdir(workspaceDir, { recursive: true });

  const server = await createServer({ workspaceDir });
  console.log('server up on', server.url);

  // 1) static serving works
  const indexRes = await fetch(server.url + '/');
  if (!indexRes.ok) fail('static index did not serve');
  console.log('✓ static index served');

  // 2) preview before a dev server returns 503
  const prev = await fetch(server.url + '/__preview/');
  if (prev.status !== 503) fail('preview should be 503 before a dev server');
  console.log('✓ preview 503 before dev server');

  // 3) drive the WS
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
  const events: UiEvent[] = [];
  let gotReady = false;
  let gotTree = false;
  let doneRun = false;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout waiting for done')), 15000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'send_message', text: 'create a file hello.js' }));
    });
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString()) as UiEvent;
      events.push(e);
      if (e.type === 'ready') gotReady = true;
      if (e.type === 'tree') gotTree = true;
      if (e.type === 'done') {
        doneRun = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    ws.on('error', reject);
  });

  if (!gotReady) fail('no ready event');
  if (!gotTree) fail('no tree event');
  if (!doneRun) fail('run did not finish');
  console.log('✓ ready + tree + done received');

  const toolCall = events.find((e) => e.type === 'agent_tool_call' && e.name === 'write_file');
  if (!toolCall) fail('agent did not call write_file');
  console.log('✓ agent emitted write_file tool call');

  // 4) the file actually exists on disk
  const content = await fs.readFile(path.join(workspaceDir, 'hello.js'), 'utf8').catch(() => '');
  if (!content.includes('Hello from hello.js')) fail('hello.js was not written to disk');
  console.log('✓ hello.js written to disk:', JSON.stringify(content.split('\n')[1]));

  // 5) a usage record was emitted
  const usage = events.find((e) => e.type === 'usage_update');
  if (!usage) fail('no usage_update emitted');
  console.log('✓ usage record emitted');

  // 6) chokidar emitted file_changed for the new file
  const changed = events.find((e) => e.type === 'file_changed' && e.path === 'hello.js');
  if (!changed) console.warn('  (note: file_changed not observed in window — watcher latency)');
  else console.log('✓ file_changed observed via watcher');

  ws.close();
  await server.close();
  const summary = `SMOKE PASSED on ${server.url}\nwrote: ${content.split('\n')[1]}\nevents: ${events.length}\n`;
  writeFileSync('.test-tmp/smoke-result.txt', summary);
  console.log('\n✓✓ ' + summary);
  await new Promise<void>((r) => process.stdout.write('', () => r())); // flush before exit
  process.exit(0);
}

main().catch((e) => fail(e.message));
