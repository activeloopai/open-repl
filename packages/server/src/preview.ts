import http from 'node:http';
import net from 'node:net';

/**
 * Preview: reverse-proxy /__preview/* to localhost:<port> so the user's dev
 * server shows inside an iframe without CORS/mixed-content headaches.
 */
export class PreviewManager {
  private port: number | null = null;

  setPort(port: number): void {
    this.port = port;
  }

  /** Forget the port when the app stops, so the proxy stops pointing at a dead
   * server and the next start re-emits preview_ready to refresh the iframe. */
  clearPort(): void {
    this.port = null;
  }

  getPort(): number | null {
    return this.port;
  }

  /** TCP poll: is something listening on the detected port? */
  async isUp(): Promise<boolean> {
    if (!this.port) return false;
    return checkPort(this.port);
  }

  /** Proxy a request whose URL starts with /__preview. Returns true if handled. */
  proxy(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    if (!this.port) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('No dev server detected yet. Run your dev command in the terminal.');
      return true;
    }
    this.attempt(req, res, 0);
    return true;
  }

  /**
   * Forward one request to the app, retrying a fresh connection for idempotent
   * requests. Dev servers with a reloader (Flask debug, nodemon) briefly refuse
   * connections while restarting on boot; without the retry the iframe's first
   * GET lands in that gap and shows "Preview target unreachable".
   */
  private attempt(req: http.IncomingMessage, res: http.ServerResponse, tries: number): void {
    const idempotent = !req.method || req.method === 'GET' || req.method === 'HEAD';
    const targetPath = (req.url || '/').replace(/^\/__preview/, '') || '/';
    const proxyReq = http.request(
      // Force identity encoding: we buffer and rewrite text/html as UTF-8, so a
      // gzip/br response from the dev server would otherwise be corrupted.
      { host: '127.0.0.1', port: this.port ?? undefined, path: targetPath, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${this.port}`, 'accept-encoding': 'identity' } },
      (proxyRes) => {
        const headers = { ...proxyRes.headers };
        // Keep redirects inside the preview: `Location: /login` would otherwise
        // send the iframe to OpenREPL's own /login.
        const loc = headers.location;
        if (typeof loc === 'string' && loc.startsWith('/') && !loc.startsWith('//')) {
          headers.location = '/__preview' + loc;
        }
        // Root-absolute URLs in served HTML (href="/x", src="/x", action="/x")
        // resolve against OpenREPL's origin, escape /__preview, and hit the SPA
        // fallback → OpenREPL renders inside its own preview ("inception").
        // Rewrite them to stay under /__preview so links, forms and assets go
        // to the app instead.
        if (String(headers['content-type'] || '').includes('text/html')) {
          const chunks: Buffer[] = [];
          proxyRes.on('data', (c: Buffer) => chunks.push(c));
          proxyRes.on('end', () => {
            const html = rewritePreviewHtml(Buffer.concat(chunks).toString('utf8'));
            delete headers['content-length']; // length changed after rewrite
            delete headers['content-encoding']; // we send decoded text
            res.writeHead(proxyRes.statusCode || 502, headers);
            res.end(html);
          });
          return;
        }
        res.writeHead(proxyRes.statusCode || 502, headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => {
      // Retry the reloader gap for idempotent requests (~1s of 200ms backoffs).
      if (idempotent && tries < 5) {
        setTimeout(() => this.attempt(req, res, tries + 1), 200);
        return;
      }
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Preview target unreachable.');
    });
    // A GET/HEAD has no body to forward; ending directly lets us retry cleanly
    // without re-piping an already-consumed request stream.
    if (idempotent) proxyReq.end();
    else req.pipe(proxyReq);
  }
}

/**
 * Prefix root-absolute URLs in HTML with /__preview so a server-rendered app's
 * links/forms/assets stay in the preview iframe instead of escaping to OpenREPL.
 * Leaves protocol-relative (//host) and absolute (http://) URLs untouched.
 */
export function rewritePreviewHtml(html: string): string {
  return html
    .replace(/(\s(?:href|src|action)\s*=\s*["'])\/(?!\/)/gi, '$1/__preview/')
    .replace(/(url\(\s*["']?)\/(?!\/)/gi, '$1/__preview/');
}

/** Anything that can expose a preview — a Session, in practice. */
export interface PreviewSource {
  getPreview(): PreviewManager | null;
}

/**
 * Pick which session's preview the /__preview proxy should serve. Ownership
 * follows the running app: the first live session whose preview has a detected
 * port wins, so a second tab or a reconnect can't steal the proxy from the
 * session that actually launched the dev server. Falls back to the most-recent
 * session (which may have no port yet) for the pre-launch "no dev server" hint.
 */
export function pickPreview(sessions: Iterable<PreviewSource>, current: PreviewSource | null): PreviewManager | null {
  for (const s of sessions) {
    const p = s.getPreview();
    if (p?.getPort() != null) return p;
  }
  return current?.getPreview() ?? null;
}

export function checkPort(port: number, host = '127.0.0.1', timeout = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}
