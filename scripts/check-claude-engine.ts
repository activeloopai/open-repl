/**
 * End-to-end proof of the Claude Agent SDK engine (PRD §6, acceptance criteria
 * 1–4). Boots the REAL server, opens a fresh project, sets provider='claude',
 * and drives it over a real WebSocket exactly like the browser would. No mocks
 * on the critical path — the only thing we cannot manufacture is a Claude
 * credential, so the whole script SKIPS cleanly (exit 0) when none is present.
 *
 * What it verifies, mapped to PRD §6:
 *   AC1 — orchestrator delegates to planner/coder/reviewer (built-in `Agent`
 *         tool calls) and files appear live (write_file tool calls + file_changed
 *         watcher events + files on disk).
 *   AC2 — the run → fix → run self-healing loop closes: run_app is called and an
 *         INDEPENDENT final probe confirms the delivered app actually serves.
 *   AC3 — Stop aborts an in-flight run within ~1s (a second run is interrupted).
 *   AC4 — a usage record is emitted for the run.
 *
 * Writes a verdict to .test-tmp/claude-engine.txt. Run: npx tsx scripts/check-claude-engine.ts
 */
import { promises as fs, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createServer } from '../packages/server/src/index.js';
import { probeApp } from '../packages/server/src/agent/probe.js';
import { parseEnv } from '../packages/server/src/secrets.js';
import type { UiEvent } from '../packages/shared/src/index.js';

const OUT = '.test-tmp/claude-engine.txt';

function report(lines: string[]): void {
  const text = lines.join('\n') + '\n';
  try {
    mkdirSync('.test-tmp', { recursive: true }); // sync: writeFileSync below must not race the dir
  } catch {
    /* best effort */
  }
  writeFileSync(OUT, text);
  process.stdout.write(text);
}

function skip(reason: string): never {
  report([
    'SKIP — Claude engine e2e not run',
    reason,
    'Provide a credential and re-run: set ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN),',
    'add ANTHROPIC_API_KEY to the repo .env, or log in with the Claude CLI (`claude login`)',
    'so ~/.claude/.credentials.json exists. Then: npx tsx scripts/check-claude-engine.ts',
  ]);
  process.exit(0);
}

/**
 * A Claude credential exists if any of: an API key in env or repo .env, a
 * subscription OAuth token in env, or the local Claude CLI credential file. We
 * surface the API key into process.env so the server's Secrets/registry picks it
 * up (same pattern as check-selfheal.ts injecting OPENROUTER_API_KEY).
 */
async function ensureCredential(): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY (env)';

  const envPath = path.resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    try {
      const env = parseEnv(await fs.readFile(envPath, 'utf8'));
      if (env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
        return 'ANTHROPIC_API_KEY (repo .env)';
      }
    } catch {
      /* fall through */
    }
  }

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return 'CLAUDE_CODE_OAUTH_TOKEN (subscription)';

  // Local Claude CLI login (subscription). Follows the symlink if ~/.claude is one.
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json');
  if (existsSync(credFile)) return 'local Claude subscription credential (~/.claude/.credentials.json)';

  skip('No Claude credential found (no ANTHROPIC_API_KEY, no CLAUDE_CODE_OAUTH_TOKEN, no ~/.claude credential).');
}

/** Resolve once an event matching `pred` has been seen (now or later). */
function waitFor(ws: WebSocket, events: UiEvent[], pred: (e: UiEvent) => boolean, ms: number): Promise<UiEvent> {
  return new Promise((resolve, reject) => {
    const existing = events.find(pred);
    if (existing) return resolve(existing);
    const cleanup = () => {
      clearTimeout(t);
      ws.off('message', h);
      ws.off('close', onClose);
      ws.off('error', onErr);
    };
    const t = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout after ${Math.round(ms / 1000)}s waiting for event`));
    }, ms);
    const onClose = () => {
      cleanup();
      reject(new Error('websocket closed before the expected event'));
    };
    const onErr = (err: Error) => {
      cleanup();
      reject(err);
    };
    const h = (raw: WebSocket.RawData) => {
      const e = JSON.parse(raw.toString()) as UiEvent;
      if (pred(e)) {
        cleanup();
        resolve(e);
      }
    };
    ws.on('message', h);
    ws.on('close', onClose);
    ws.on('error', onErr);
  });
}

function isToolCall(e: UiEvent, name: string): boolean {
  return e.type === 'agent_tool_call' && (e as { name?: string }).name === name;
}

async function main() {
  const credSource = await ensureCredential();

  const base = path.resolve(process.cwd(), '.test-tmp', 'claude-engine-' + randomUUID());
  const projectDir = path.join(base, 'todo');
  await fs.mkdir(projectDir, { recursive: true });

  const server = await createServer({
    projectsRoot: path.join(base, 'p'),
    registryPath: path.join(base, 'r.json'),
    port: 4799,
  });

  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
  const events: UiEvent[] = [];
  ws.on('message', (raw) => events.push(JSON.parse(raw.toString()) as UiEvent));

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  // Open a fresh project. DEFAULT_CONFIG.provider is already 'claude', so the
  // run goes through ClaudeAgentEngine — assert it from the ready event.
  ws.send(JSON.stringify({ type: 'open_project', path: projectDir }));
  const ready = (await waitFor(
    ws,
    events,
    (e) => e.type === 'ready' && (e as Extract<UiEvent, { type: 'ready' }>).workspaceDir === projectDir,
    10000,
  )) as Extract<UiEvent, { type: 'ready' }>;
  if (ready.provider !== 'claude') {
    report([`FAIL — project did not open with provider='claude' (got '${ready.provider}')`]);
    ws.close();
    await server.close();
    process.exit(1);
  }

  /* ---------- Phase A: full build (AC1, AC2, AC4) ---------- */
  ws.send(
    JSON.stringify({
      type: 'send_message',
      text:
        'Create a small Flask + SQLite todo web app: add a task, list tasks, mark done, delete. ' +
        'Delegate the work (plan, then code, then review) and make sure it actually runs.',
    }),
  );

  // The full multi-agent build + self-heal loop can take minutes.
  await waitFor(ws, events, (e) => e.type === 'done', 360_000).catch((err) => {
    report([`FAIL — build run did not finish: ${err.message}`, `credential: ${credSource}`]);
    process.exitCode = 1;
  });

  const agentCalls = events.filter((e) => isToolCall(e, 'Agent'));
  const delegated = agentCalls
    .map((e) => {
      const args = (e as { args?: Record<string, unknown> }).args ?? {};
      return String(args.subagent_type ?? args.agent ?? args.description ?? '').slice(0, 60);
    })
    .filter(Boolean);
  // Subagents write via the SDK's built-in Write/Edit tools (the in-process MCP
  // server only reaches the main thread), so count those alongside the legacy
  // mcp write_file. The authoritative live-file signals remain file_changed
  // (chokidar) + files actually on disk.
  const writes = events.filter(
    (e) => isToolCall(e, 'write_file') || isToolCall(e, 'Write') || isToolCall(e, 'Edit'),
  );
  const runApps = events.filter((e) => isToolCall(e, 'run_app'));
  const fileChanges = events.filter((e) => e.type === 'file_changed');
  const usage = events.find((e) => e.type === 'usage_update') as Extract<UiEvent, { type: 'usage_update' }> | undefined;
  const errors = events.filter((e) => e.type === 'error').map((e) => (e as { message?: string }).message);

  const filesOnDisk = (await fs.readdir(projectDir).catch(() => [])).filter((f) => f !== '.openrepl');

  // AC2 authoritative check: independent of what the agent claimed, does the
  // delivered app actually serve? (Same probe the self-heal check trusts.)
  const finalProbe = await probeApp(projectDir, async () => ({}));

  // AC1 — delegation happened: at least one built-in Agent delegation.
  const ac1Delegated = agentCalls.length > 0;
  // AC1 — files appeared live: write_file tool calls + watcher saw them + on disk.
  const ac1Live = writes.length > 0 && fileChanges.length > 0 && filesOnDisk.length > 0;
  // AC2 — self-heal loop: run_app was exercised AND the app independently serves.
  const ac2 = runApps.length > 0 && finalProbe.ok;
  // AC4 — usage recorded (subscription → planUnits, API key → costUSD).
  const ac4 = !!usage;

  /* ---------- Phase B: Stop aborts an in-flight run (AC3) ---------- */
  let ac3 = false;
  let abortMs = -1;
  try {
    ws.send(JSON.stringify({ type: 'send_message', text: 'Now add a /stats page showing how many tasks are done vs open.' }));
    // Wait until THIS run is genuinely in flight. Seed with [] (a fresh listener)
    // so we ignore Phase A's tool calls already sitting in `events` and only
    // react to a new token/tool_use — otherwise we'd Stop before it even starts.
    await waitFor(ws, [], (e) => e.type === 'agent_tool_call' || e.type === 'agent_token', 60_000);
    const t0 = Date.now();
    ws.send(JSON.stringify({ type: 'stop', runId: 'abort' }));
    await waitFor(ws, [], (e) => e.type === 'done', 10_000); // fresh listener: the NEXT done
    abortMs = Date.now() - t0;
    ac3 = abortMs <= 3000; // PRD says ~1s; allow slack for WS + SDK teardown.
  } catch (err) {
    abortMs = -1;
    ac3 = false;
    errors.push(`abort phase: ${(err as Error).message}`);
  }

  ws.close();
  await server.close();

  const pass = ac1Delegated && ac1Live && ac2 && ac4 && ac3;
  report([
    `credential: ${credSource}`,
    `provider at ready: ${ready.provider}`,
    '',
    `AC1 delegation — Agent tool calls: ${agentCalls.length}${delegated.length ? ' → ' + delegated.join(', ') : ''}  [${ac1Delegated ? 'PASS' : 'FAIL'}]`,
    `AC1 live files — write_file: ${writes.length}, file_changed: ${fileChanges.length}, on disk: ${filesOnDisk.join(', ') || '(none)'}  [${ac1Live ? 'PASS' : 'FAIL'}]`,
    `AC2 self-heal — run_app calls: ${runApps.length}, INDEPENDENT probe ok: ${finalProbe.ok}${finalProbe.url ? ' (' + finalProbe.url + ')' : ''}  [${ac2 ? 'PASS' : 'FAIL'}]`,
    ac2 ? '' : `      final probe logs (tail): ${finalProbe.logs.slice(-400)}`,
    `AC3 stop — aborted in ${abortMs >= 0 ? abortMs + 'ms' : 'n/a'} (≤3000ms)  [${ac3 ? 'PASS' : 'FAIL'}]`,
    `AC4 usage — record emitted: ${ac4}${usage ? ` (tokensIn=${usage.record.tokensIn}, tokensOut=${usage.record.tokensOut}, costUSD=${usage.record.costUSD}, planUnits=${usage.record.planUnits})` : ''}  [${ac4 ? 'PASS' : 'FAIL'}]`,
    `agent errors: ${errors.filter(Boolean).join(' | ') || '(none)'}`,
    '',
    `VERDICT: ${pass ? 'PASS — Claude engine drives orchestrator→subagents, self-heals, streams live, aborts, and records usage' : 'FAIL — see failing criteria above'}`,
  ].filter((l) => l !== undefined) as string[]);

  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  report(['CLAUDE-ENGINE CHECK ERROR: ' + (e?.stack ?? e?.message ?? e)]);
  process.exit(1);
});
