/**
 * The real proof of the run-and-fix loop: a FRESH project, ask for a Flask todo
 * app, and check whether the system delivers an app that ACTUALLY RUNS — fixing
 * its own errors via run_app, with no human. Writes to .test-tmp/selfheal.txt.
 */
import { promises as fs, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../packages/server/src/index.js';
import { probeApp } from '../packages/server/src/agent/probe.js';
import { parseEnv } from '../packages/server/src/secrets.js';
import type { UiEvent } from '../packages/shared/src/index.js';

async function main() {
  const env = parseEnv(await fs.readFile(path.resolve(process.cwd(), '.env'), 'utf8'));
  if (env.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;

  const base = path.resolve(process.cwd(), '.test-tmp', 'selfheal-' + randomUUID());
  const projectDir = path.join(base, 'todo');
  await fs.mkdir(projectDir, { recursive: true });

  const server = await createServer({ projectsRoot: path.join(base, 'p'), registryPath: path.join(base, 'r.json'), port: 4798 });
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
  const events: UiEvent[] = [];

  await new Promise<void>((r) => ws.on('open', () => r()));
  ws.send(JSON.stringify({ type: 'open_project', path: projectDir }));

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout (280s)')), 280000);
    let asked = false;
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString()) as UiEvent;
      events.push(e);
      if (e.type === 'ready' && !asked) {
        asked = true;
        ws.send(JSON.stringify({ type: 'send_message', text: 'Create a small Flask + SQLite todo web app: add a task, list tasks, mark done, delete. Make sure it actually runs.' }));
      }
      if (e.type === 'done') {
        clearTimeout(t);
        resolve();
      }
    });
    ws.on('error', reject);
  });

  const runAppCalls = events.filter((e) => e.type === 'agent_tool_call' && (e as any).name === 'run_app').length;
  const writes = events.filter((e) => e.type === 'agent_tool_call' && (e as any).name === 'write_file').length;
  const agentErrors = events.filter((e) => e.type === 'error').map((e) => (e as any).message);
  const files = (await fs.readdir(projectDir).catch(() => [])).filter((f) => f !== '.openrepl');

  // Independent final check: does the delivered app actually run?
  const finalProbe = await probeApp(projectDir, async () => ({}));

  const summary = [
    `files created: ${files.join(', ') || '(none)'}`,
    `agent called run_app: ${runAppCalls} time(s)`,
    `write_file calls: ${writes}`,
    `agent errors: ${agentErrors.join(' | ') || '(none)'}`,
    `INDEPENDENT final probe → ok: ${finalProbe.ok}${finalProbe.url ? ' (' + finalProbe.url + ')' : ''}`,
    finalProbe.ok ? '' : `final probe logs (tail): ${finalProbe.logs.slice(-500)}`,
    `verdict: ${finalProbe.ok ? 'PASS — system self-delivered a RUNNING app' : 'FAIL — app still broken'}`,
  ].join('\n');

  writeFileSync('.test-tmp/selfheal.txt', summary + '\n');
  ws.close();
  await server.close();
}

main().catch((e) => writeFileSync('.test-tmp/selfheal.txt', 'SELFHEAL ERROR: ' + (e?.message ?? e)));
