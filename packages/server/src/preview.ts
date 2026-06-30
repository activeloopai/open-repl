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
    const targetPath = (req.url || '/').replace(/^\/__preview/, '') || '/';
    const proxyReq = http.request(
      { host: '127.0.0.1', port: this.port, path: targetPath, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${this.port}` } },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Preview target unreachable.');
    });
    req.pipe(proxyReq);
    return true;
  }
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
