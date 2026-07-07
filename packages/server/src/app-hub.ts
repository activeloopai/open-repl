import type { UiEvent, Workflow } from '@openrepl/shared';
import { detectWorkflows, WorkflowManager } from './workflow.js';
import { PreviewManager } from './preview.js';
import { CommandRunner } from './runner.js';

type AppStatus = Extract<UiEvent, { type: 'app_status' }>;

interface RunningApp {
  mgr: WorkflowManager | null;
  installer: CommandRunner | null;
  preview: PreviewManager;
  workflows: Workflow[];
  activeWorkflow: string | null;
  status: AppStatus | null;
}

/**
 * Server-level owner of the *running app*, keyed by workspace dir. The app is
 * one thing per workspace; sessions (tabs, reconnects) are many. Keeping run /
 * stop / preview here — instead of in a per-session mount — means every client
 * viewing that workspace sees the same status and Stop button, and Stop always
 * reaches the real process no matter which tab clicked it.
 *
 * Events are broadcast with the dir they belong to; a session forwards only the
 * events for the workspace it currently has open.
 */
export class AppHub {
  private apps = new Map<string, RunningApp>();
  private listeners = new Set<(dir: string, e: UiEvent) => void>();
  /** Per-dir promise chain so overlapping run()/stop() can't interleave and
   * clear or swap `app.mgr` mid-start. */
  private locks = new Map<string, Promise<unknown>>();

  subscribe(fn: (dir: string, e: UiEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private broadcast(dir: string, e: UiEvent): void {
    for (const l of this.listeners) l(dir, e);
  }

  private appFor(dir: string): RunningApp {
    const existing = this.apps.get(dir);
    if (existing) return existing;
    const created: RunningApp = { mgr: null, installer: null, preview: new PreviewManager(), workflows: [], activeWorkflow: null, status: null };
    this.apps.set(dir, created);
    return created;
  }

  preview(dir: string): PreviewManager | null {
    return this.apps.get(dir)?.preview ?? null;
  }
  status(dir: string): AppStatus | null {
    return this.apps.get(dir)?.status ?? null;
  }
  activeWorkflow(dir: string): string | null {
    return this.apps.get(dir)?.activeWorkflow ?? null;
  }

  /** The preview of whichever workspace currently has a running app, if any. */
  runningPreview(): PreviewManager | null {
    for (const a of this.apps.values()) if (a.preview.getPort() != null) return a.preview;
    return null;
  }

  /** A dev server the user started in the terminal — surface it in the preview. */
  notePort(dir: string, port: number): void {
    const a = this.appFor(dir);
    if (a.preview.getPort() !== port) {
      a.preview.setPort(port);
      this.broadcast(dir, { type: 'preview_ready', url: '/__preview/' });
    }
  }

  private setStatus(dir: string, status: AppStatus): void {
    this.appFor(dir).status = status;
    this.broadcast(dir, status);
  }

  /** Serialize run()/stop() per dir so they can't interleave. */
  private serialize<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(dir) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(dir, next.then(() => {}, () => {}));
    return next;
  }

  /** Run (or re-run) the app for `dir`. Returns the detected workflows. */
  run(dir: string, getEnv: () => Promise<Record<string, string>>, name?: string): Promise<Workflow[]> {
    return this.serialize(dir, () => this.runLocked(dir, getEnv, name));
  }

  private async runLocked(dir: string, getEnv: () => Promise<Record<string, string>>, name?: string): Promise<Workflow[]> {
    await this.stopLocked(dir);
    const det = await detectWorkflows(dir);
    const app = this.appFor(dir);
    app.workflows = det.workflows;
    if (det.self) {
      this.setStatus(dir, { type: 'app_status', state: 'error', message: 'This is the OpenREPL folder itself — open your own app folder.' });
      return det.workflows;
    }
    const wf = name ? det.workflows.find((w) => w.name === name) : det.workflows[0];
    if (!wf) {
      this.setStatus(dir, { type: 'app_status', state: 'error', message: 'No runnable app found. Ask the agent to create one (e.g. an index.html or a package.json with a dev/start script).' });
      return det.workflows;
    }
    try {
      if (det.install) {
        this.setStatus(dir, { type: 'app_status', state: 'installing', message: `Installing dependencies… (${det.install})` });
        app.installer = new CommandRunner(dir, getEnv, (data) => this.broadcast(dir, { type: 'term_data', data: `[install] ${data}` }), () => {});
        const code = await app.installer.run(det.install);
        app.installer = null;
        if (code !== 0) {
          this.setStatus(dir, { type: 'app_status', state: 'error', message: 'Dependency install failed — see the terminal output.' });
          return det.workflows;
        }
      }
      this.setStatus(dir, { type: 'app_status', state: 'starting', message: `Starting workflow "${wf.name}" — ${wf.steps.map((s) => s.name).join(' + ')}` });
      // Only the last spawned step exiting means the app is really down: a
      // backend+frontend workflow shouldn't flip to "stopped" when one exits.
      let live = wf.steps.filter((s) => s.command && !s.static).length;
      const mgr = new WorkflowManager(
        dir,
        getEnv,
        (step, data) => this.broadcast(dir, { type: 'term_data', data: `[${step}] ${data}` }),
        (port) => {
          this.notePort(dir, port);
          this.setStatus(dir, { type: 'app_status', state: 'running', message: `"${wf.name}" running` });
        },
        (step, code) => {
          if (mgr !== app.mgr) return; // a newer run replaced this workflow
          if (--live > 0) return;
          app.mgr = null;
          app.activeWorkflow = null;
          app.preview.clearPort();
          this.setStatus(dir, { type: 'app_status', state: 'stopped', message: `${step} exited (code ${code})` });
        },
      );
      app.mgr = mgr;
      await mgr.start(wf);
      app.activeWorkflow = wf.name;
    } catch (e) {
      // spawn ENOENT, permission error, etc. — surface it instead of leaving the
      // UI stuck on "installing…"/"starting…".
      app.installer = null;
      app.mgr = null;
      this.setStatus(dir, { type: 'app_status', state: 'error', message: `Failed to start: ${e instanceof Error ? e.message : String(e)}` });
    }
    return det.workflows;
  }

  /** Stop the app for `dir` — kills the workflow tree and any in-flight install. */
  stop(dir: string): Promise<void> {
    return this.serialize(dir, () => this.stopLocked(dir));
  }

  private async stopLocked(dir: string): Promise<void> {
    const app = this.apps.get(dir);
    if (app) {
      app.installer?.stopRuns();
      app.installer = null;
      if (app.mgr) {
        await app.mgr.stop();
        app.mgr = null;
      }
      app.activeWorkflow = null;
      // Drop the stale port so runningPreview()/the proxy stop pointing at the
      // now-dead server (the source of intermittent "target unreachable" 502s).
      app.preview.clearPort();
    }
    this.setStatus(dir, { type: 'app_status', state: 'stopped' });
  }
}
