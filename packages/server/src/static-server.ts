import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findFreePort } from './net-util.js';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface StaticServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Tiny static file server for "no dev server" apps (a plain index.html the
 * agent produced). No caching, so edits show on reload. Lives in-process so it
 * works offline — no `npx serve` install needed.
 */
export async function startStaticServer(dir: string): Promise<StaticServer> {
  const root = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel === '/' || rel === '') rel = '/index.html';
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    try {
      const data = await fs.readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    } catch {
      // SPA-ish fallback to index.html
      try {
        const index = await fs.readFile(path.join(root, 'index.html'));
        res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        res.end(index);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    }
  });

  const port = await findFreePort(5500);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
