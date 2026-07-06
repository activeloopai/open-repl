import http from 'node:http';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFreePort } from './net-util.js';
import { WebSocketServer } from 'ws';
import type { ClientCommand, UiEvent } from '@openrepl/shared';
import { Session } from './session.js';
import { ProjectRegistry } from './projects.js';
import { pickPreview } from './preview.js';
import { AppHub } from './app-hub.js';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

export interface ServerOptions {
  /** Where new projects are created by default. */
  projectsRoot?: string;
  /** Registry file tracking the user's projects. */
  registryPath?: string;
  /** Open this folder as a project on startup (the CLI's positional arg). */
  initialProject?: string;
  port?: number;
  webDir?: string;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

function defaultWebDir(): string {
  // packages/server/src/index.ts -> packages/web/dist
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../web/dist');
}

export async function createServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const webDir = opts.webDir ?? defaultWebDir();
  const projectsRoot = path.resolve(opts.projectsRoot ?? path.join(os.homedir(), 'openrepl-projects'));
  const registryPath = path.resolve(opts.registryPath ?? path.join(os.homedir(), '.openrepl', 'projects.json'));
  const projects = new ProjectRegistry(registryPath, projectsRoot);

  // Open the folder passed on the CLI (if any) as the most-recent project.
  if (opts.initialProject) {
    await projects.open(path.resolve(opts.initialProject)).catch(() => undefined);
  }

  // The running app is workspace-level, not per-connection: it lives in the hub
  // so a second tab or a reconnect sees the same status/preview and can Stop it.
  const hub = new AppHub();
  const sessions = new Set<Session>();
  let currentSession: Session | null = null;

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    if (url.startsWith('/__preview')) {
      // The hub owns any running app; fall back to a session's preview for a
      // dev server started in the terminal before an app is registered.
      const preview = hub.runningPreview() ?? pickPreview(sessions, currentSession);
      if (preview) preview.proxy(req, res);
      else {
        res.writeHead(503);
        res.end('No active preview.');
      }
      return;
    }

    // Static file serving from the built web app.
    try {
      let rel = decodeURIComponent(url.split('?')[0]);
      if (rel === '/' || rel === '') rel = '/index.html';
      const filePath = path.join(webDir, rel);
      if (!filePath.startsWith(webDir)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      const data = await fs.readFile(filePath).catch(async () => {
        // SPA fallback
        return fs.readFile(path.join(webDir, 'index.html'));
      });
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'text/html' });
      res.end(data);
    } catch {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(fallbackHtml());
    }
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    const emit = (event: UiEvent) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    };
    const session = new Session(emit, projects, hub);
    sessions.add(session);
    currentSession = session;
    session.init().catch((e) => emit({ type: 'error', scope: 'init', message: String(e) }));

    ws.on('message', (raw) => {
      let cmd: ClientCommand;
      try {
        cmd = JSON.parse(raw.toString());
      } catch {
        return;
      }
      session.handle(cmd);
    });
    ws.on('close', () => {
      session.close();
      sessions.delete(session);
      if (currentSession === session) currentSession = [...sessions].pop() ?? null;
    });
  });

  const port = await listen(server, opts.port ?? 4317);
  return {
    port,
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        wss.clients.forEach((c) => c.close());
        server.close(() => resolve());
      }),
  };
}

/**
 * Pick a free port up front, then listen once. (Re-calling server.listen()
 * after EADDRINUSE on the same server hangs — so we never rely on that.)
 */
async function listen(server: http.Server, startPort: number): Promise<number> {
  const port = await findFreePort(startPort);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return port;
}

function fallbackHtml(): string {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
  <h1>OpenREPL</h1>
  <p>The web UI isn't built yet. Run <code>npm run build:web</code> then reload.</p>
  </body></html>`;
}
