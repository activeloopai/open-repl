/**
 * Real end-to-end test against OpenRouter, using the key from the project ./.env.
 * Drives the actual Session over WebSocket like the browser does, multi-agent on.
 * Writes the outcome to .test-tmp/e2e.txt (avoids process.exit stdout truncation).
 */
import { promises as fs, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../packages/server/src/index.js';
import { parseEnv } from '../packages/server/src/secrets.js';
import type { UiEvent } from '../packages/shared/src/index.js';

async function main() {
  // Load the key from the project .env into process.env (inside the folder).
  const env = parseEnv(await fs.readFile(path.resolve(process.cwd(), '.env'), 'utf8'));
  if (env.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;

  const ws1 = path.resolve(process.cwd(), '.test-tmp', 'e2e-' + randomUUID());
  await fs.mkdir(ws1, { recursive: true });

  const server = await createServer({ workspaceDir: ws1, port: 4770 });
  const events: UiEvent[] = [];

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
    const t = setTimeout(() => reject(new Error('timeout (120s)')), 120000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'send_message', text: 'Create a file hello.js that prints "hello world".' })));
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString()) as UiEvent;
      events.push(e);
      if (e.type === 'done') {
        clearTimeout(t);
        ws.close();
        resolve();
      }
    });
    ws.on('error', reject);
  });

  const fileWritten = await fs
    .readFile(path.join(ws1, 'hello.js'), 'utf8')
    .then((c) => c.length > 0)
    .catch(() => false);
  const delegations = events.filter((e) => e.type === 'agent_tool_call' && (e as any).name?.startsWith('delegate_to_')).map((e) => (e as any).name);
  const toolCalls = events.filter((e) => e.type === 'agent_tool_call').map((e) => (e as any).name);
  const tokens = events.filter((e) => e.type === 'agent_token').length;
  const usage = events.find((e) => e.type === 'usage_update') as any;
  const errors = events.filter((e) => e.type === 'error').map((e) => (e as any).message);

  const summary = [
    `file hello.js written: ${fileWritten}`,
    `delegations: ${delegations.join(', ') || '(none)'}`,
    `tool calls: ${toolCalls.join(', ') || '(none)'}`,
    `streamed token chunks: ${tokens}`,
    `usage: ${usage ? `provider=${usage.record.provider} model=${usage.record.model} in=${usage.record.tokensIn} out=${usage.record.tokensOut} costUSD=${usage.record.costUSD}` : '(none)'}`,
    `errors: ${errors.join(' | ') || '(none)'}`,
    `verdict: ${fileWritten && !errors.length ? 'PASS' : 'CHECK'}`,
  ].join('\n');

  writeFileSync('.test-tmp/e2e.txt', summary + '\n');
  await server.close();
}

main().catch((e) => writeFileSync('.test-tmp/e2e.txt', 'E2E ERROR: ' + (e?.message ?? e) + '\n'));
