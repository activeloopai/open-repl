import { describe, it, expect } from 'vitest';
import { createServer } from '../src/index.js';
import { tmpWorkspace } from './helpers.js';

describe('createServer', () => {
  it('serves the index and returns 503 for preview before a dev server', async () => {
    const server = await createServer({ workspaceDir: await tmpWorkspace(), port: 4710 });
    try {
      const index = await fetch(server.url + '/');
      expect(index.status).toBe(200);
      const preview = await fetch(server.url + '/__preview/');
      expect(preview.status).toBe(503);
    } finally {
      await server.close();
    }
  });

  it('auto-picks the next free port when the requested one is busy (regression: no hang)', async () => {
    const a = await createServer({ workspaceDir: await tmpWorkspace(), port: 4720 });
    const b = await createServer({ workspaceDir: await tmpWorkspace(), port: 4720 });
    try {
      expect(a.port).toBe(4720);
      expect(b.port).toBeGreaterThan(a.port); // did not hang, did not collide
    } finally {
      await a.close();
      await b.close();
    }
  });
});
