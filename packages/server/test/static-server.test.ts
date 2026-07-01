import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { startStaticServer } from '../src/static-server.js';
import { tmpWorkspace } from './helpers.js';

describe('startStaticServer', () => {
  it('serves files from the directory and stops on close', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>STATIC-ROOT</h1>');
    await fs.writeFile(path.join(dir, 'style.css'), 'body{}');
    const server = await startStaticServer(dir);
    try {
      expect(server.port).toBeGreaterThan(0);
      expect(await (await fetch(`http://localhost:${server.port}/`)).text()).toContain('STATIC-ROOT');
      const css = await fetch(`http://localhost:${server.port}/style.css`);
      expect(css.status).toBe(200);
    } finally {
      await server.close();
    }
    // after close the port no longer accepts connections
    await expect(fetch(`http://localhost:${server.port}/`)).rejects.toBeTruthy();
  });
});
