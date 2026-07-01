import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { detectWorkflows, WorkflowManager } from '../workflow.js';

export interface ProbeResult {
  ok: boolean;
  url?: string;
  /** Recent logs / traceback — what the agent reads to fix a failure. */
  logs: string;
}

/**
 * Start the app, watch what happens, then stop it. This is the "run" half of
 * the run-and-fix loop: the agent calls it, reads the result, fixes, repeats.
 *  - port detected  → ok (the app serves)
 *  - non-zero exit  → crash (logs hold the traceback)
 *  - still alive after the timeout, no port → assume ok (server without a
 *    recognizable port line)
 */
export async function probeApp(
  dir: string,
  getEnv: () => Promise<Record<string, string>>,
  timeoutMs = 12000,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  if (signal?.aborted) return { ok: false, logs: 'aborted' };
  const det = await detectWorkflows(dir);
  if (det.self) return { ok: false, logs: 'This folder is OpenREPL itself — not a user app.' };
  const wf = det.workflows[0];
  if (!wf) {
    return { ok: false, logs: 'No runnable app detected. Create a package.json with a dev/start script, an index.html, or a Python entrypoint (app.py/main.py/manage.py).' };
  }

  let logs = '';
  const env = { ...process.env, ...(await getEnv()) } as Record<string, string>;

  if (det.install) {
    const r = await runOnce(dir, det.install, env, signal);
    logs += r.output;
    if (r.code !== 0) return { ok: false, logs: trim(logs + `\n[dependency install failed: ${det.install}]`) };
  }
  if (signal?.aborted) return { ok: false, logs: trim(logs + '\n[aborted]') };

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const mgr = new WorkflowManager(
      dir,
      getEnv,
      (step, data) => {
        logs += `[${step}] ${data}`;
      },
      (port) => finish({ ok: true, url: `http://localhost:${port}`, logs: trim(logs) }),
      (step, code) => {
        if (code !== 0) finish({ ok: false, logs: trim(logs + `\n[${step} exited with code ${code}]`) });
      },
    );
    const finish = (res: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      mgr.stop().finally(() => resolve(res));
    };
    // Stop cancels the probe: tear down the spawned app instead of leaving it
    // (and its port) running after the user stopped the turn.
    const onAbort = () => finish({ ok: false, logs: trim(logs + '\n[aborted]') });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish({ ok: true, logs: trim(logs + '\n[app started; no crash detected]') }), timeoutMs);
    mgr.start(wf).catch((e) => finish({ ok: false, logs: trim(logs + `\n[failed to start: ${e}]`) }));
  });
}

/** Keep only the tail — tracebacks live at the end and the LLM context is finite. */
function trim(s: string, max = 3000): string {
  return s.length > max ? '…' + s.slice(-max) : s;
}

function runOnce(
  cwd: string,
  command: string,
  env: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    // detached so Stop can signal the whole install tree (npm/pip), not just the shell.
    const p = spawn(command, { cwd, env, shell: true, stdio: 'pipe', detached: true }) as ChildProcessWithoutNullStreams;
    let out = '';
    let aborted = false;
    const grab = (b: Buffer) => (out += b.toString());
    const onAbort = () => {
      aborted = true;
      try {
        if (p.pid) process.kill(-p.pid, 'SIGTERM');
        else p.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const settle = (code: number) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, output: out });
    };
    p.stdout.on('data', grab);
    p.stderr.on('data', grab);
    // A signal-killed install reports code=null — don't map that to 0 (success).
    p.on('close', (code) => settle(code ?? (aborted ? 130 : 1)));
    p.on('error', (e) => {
      out += String(e);
      settle(1);
    });
  });
}
