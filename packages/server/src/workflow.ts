import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Workflow, WorkflowStep } from '@openrepl/shared';
import { detectPort } from './runner.js';
import { startStaticServer, type StaticServer } from './static-server.js';
import { dotDir } from './config.js';

export interface DetectResult {
  self: boolean;
  /** Command to run before starting (npm install / venv+pip), or null. */
  install: string | null;
  workflows: Workflow[];
}

const BACKEND_RE = /^(dev:)?(server|backend|api|be)$/i;
const FRONTEND_RE = /^(dev:)?(web|client|frontend|fe|ui)$/i;

/**
 * Figure out how to run the user's app — auto-detected run configurations.
 * OpenREPL stays framework-agnostic: whoever builds the app (the agent, or the
 * user) declares how to run it, and OpenREPL just runs that. Priority:
 * declared run command (.openrepl/workflows.json → Procfile) → auto-detected
 * Node/Python/static as a convenience fallback.
 */
export async function detectWorkflows(workspaceDir: string): Promise<DetectResult> {
  let pkg: any = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(workspaceDir, 'package.json'), 'utf8'));
  } catch {
    /* no package.json */
  }

  if (pkg && isOpenReplItself(pkg)) return { self: true, install: null, workflows: [] };

  // 1) declared run command — .openrepl/workflows.json (richest) then Procfile.
  // These let any stack (FastAPI, Go, Rails, …) run without OpenREPL knowing the
  // framework; the framework knowledge lives in the declared command.
  const userDefined = await loadUserWorkflows(workspaceDir);
  if (userDefined.length) {
    return { self: false, install: await detectInstall(workspaceDir, pkg), workflows: userDefined };
  }
  const procSteps = await loadProcfile(workspaceDir);
  if (procSteps.length) {
    return { self: false, install: await detectInstall(workspaceDir, pkg), workflows: [{ name: 'Dev', steps: procSteps }] };
  }

  // 2) Node — auto-detect from package.json scripts
  if (pkg?.scripts) {
    const scripts = Object.keys(pkg.scripts);
    if (scripts.some((s) => /packages\/cli|\bopenrepl\b/.test(pkg.scripts[s]))) {
      return { self: true, install: null, workflows: [] };
    }
    const be = scripts.find((s) => BACKEND_RE.test(s));
    const fe = scripts.find((s) => FRONTEND_RE.test(s));
    const install = await nodeInstall(workspaceDir, pkg);

    if (be && fe) {
      return {
        self: false,
        install,
        workflows: [
          { name: 'Dev', steps: [{ name: 'backend', command: `npm run ${be}` }, { name: 'frontend', command: `npm run ${fe}`, preview: true }] },
        ],
      };
    }
    const single = pkg.scripts.dev ? 'dev' : pkg.scripts.start ? 'start' : null;
    if (single) {
      return {
        self: false,
        install,
        workflows: [{ name: 'Dev', steps: [{ name: 'app', command: single === 'dev' ? 'npm run dev' : 'npm start', preview: true }] }],
      };
    }
  }

  // 3) Python (Flask / Django / generic entrypoint)
  const py = await detectPython(workspaceDir);
  if (py) {
    return { self: false, install: py.install, workflows: [{ name: 'Dev', steps: [{ name: py.name, command: py.command, preview: true }] }] };
  }

  // 4) static site
  if (await exists(path.join(workspaceDir, 'index.html'))) {
    return { self: false, install: null, workflows: [{ name: 'Static', steps: [{ name: 'site', static: true, preview: true }] }] };
  }

  return { self: false, install: null, workflows: [] };
}

/** Detect a runnable Python app and how to install/run it (managed .venv). */
async function detectPython(dir: string): Promise<{ name: string; command: string; install: string | null } | null> {
  const reqs = await exists(path.join(dir, 'requirements.txt'));
  const venvExists = await exists(path.join(dir, '.venv'));
  // When there are requirements we manage a local .venv; otherwise use system python3.
  const py = reqs ? '.venv/bin/python' : 'python3';
  const install = reqs && !venvExists ? 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt' : null;

  if (await exists(path.join(dir, 'manage.py'))) {
    return { name: 'django', command: `${py} manage.py runserver`, install };
  }
  for (const entry of ['app.py', 'main.py', 'wsgi.py', 'server.py']) {
    if (await exists(path.join(dir, entry))) return { name: 'python', command: `${py} ${entry}`, install };
  }
  return null;
}

/** Runs the steps of a workflow together (multiple processes) and stops them as a unit. */
export class WorkflowManager {
  private procs: ChildProcessWithoutNullStreams[] = [];
  private statics: StaticServer[] = [];

  constructor(
    private cwd: string,
    private env: () => Promise<Record<string, string>>,
    private onData: (step: string, data: string) => void,
    private onPreview: (port: number) => void,
    private onExit: (step: string, code: number) => void,
  ) {}

  async start(workflow: Workflow): Promise<void> {
    const env = { ...process.env, ...(await this.env()) };
    for (const step of workflow.steps) {
      if (step.static) {
        const server = await startStaticServer(this.cwd);
        this.statics.push(server);
        if (step.preview) this.onPreview(server.port);
        this.onData(step.name, `serving static site on :${server.port}\n`);
        continue;
      }
      if (!step.command) continue;
      // detached → own process group, so stop() can kill the whole tree
      // (with shell:true, killing the shell alone would orphan the real process).
      const p = spawn(step.command, { cwd: this.cwd, env, shell: true, stdio: 'pipe', detached: true }) as ChildProcessWithoutNullStreams;
      this.procs.push(p);
      const handle = (buf: Buffer) => {
        const text = buf.toString();
        this.onData(step.name, text);
        if (step.preview) {
          const port = detectPort(text);
          if (port) this.onPreview(port);
        }
      };
      p.stdout.on('data', handle);
      p.stderr.on('data', handle);
      p.on('exit', (code) => this.onExit(step.name, code ?? 0));
    }
  }

  running(): boolean {
    return this.procs.length > 0 || this.statics.length > 0;
  }

  async stop(): Promise<void> {
    for (const p of this.procs) killTree(p);
    this.procs = [];
    for (const s of this.statics) await s.close();
    this.statics = [];
  }
}

/** Kill a detached child and its whole process group (so dev servers really stop). */
function killTree(p: ChildProcessWithoutNullStreams): void {
  try {
    if (p.pid) process.kill(-p.pid, 'SIGTERM');
    else p.kill('SIGTERM');
  } catch {
    try {
      p.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function isOpenReplItself(pkg: any): boolean {
  const name = String(pkg?.name ?? '');
  if (name === 'openrepl' || name === 'openrepl-monorepo') return true;
  if (pkg?.bin && typeof pkg.bin === 'object' && 'openrepl' in pkg.bin) return true;
  if (Array.isArray(pkg?.workspaces) && pkg.workspaces.some((w: string) => w.includes('packages/cli'))) return true;
  return false;
}

async function loadUserWorkflows(workspaceDir: string): Promise<Workflow[]> {
  try {
    const raw = await fs.readFile(path.join(dotDir(workspaceDir), 'workflows.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.workflows) ? parsed.workflows : Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function nodeInstall(workspaceDir: string, pkg: any): Promise<string | null> {
  if (!pkg) return null;
  return (await exists(path.join(workspaceDir, 'node_modules'))) ? null : 'npm install';
}

/**
 * Parse a Procfile (`process_name: command` per line — the Heroku/Foreman
 * convention) into workflow steps. Language-agnostic: the command is whatever
 * the author wrote. The `web` process (or the first line) is what the Preview
 * points at.
 */
async function loadProcfile(workspaceDir: string): Promise<WorkflowStep[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(workspaceDir, 'Procfile'), 'utf8');
  } catch {
    return [];
  }
  const steps: WorkflowStep[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (m) steps.push({ name: m[1], command: m[2] });
  }
  if (!steps.length) return [];
  (steps.find((s) => s.name === 'web') ?? steps[0]).preview = true;
  return steps;
}

/**
 * Convenience dependency install for a *declared* run (workflows.json/Procfile):
 * npm for Node, a managed .venv for Python. The run command itself is declared;
 * this only makes its dependencies available. Framework-agnostic — no assumption
 * about how the app is served.
 */
async function detectInstall(workspaceDir: string, pkg: any): Promise<string | null> {
  const node = await nodeInstall(workspaceDir, pkg);
  if (node) return node;
  const reqs = await exists(path.join(workspaceDir, 'requirements.txt'));
  const venv = await exists(path.join(workspaceDir, '.venv'));
  if (reqs && !venv) return 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt';
  return null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
