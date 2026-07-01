import { describe, it, expect } from 'vitest';
import { PreviewManager, checkPort } from '../src/preview.js';
import { startStaticServer } from '../src/static-server.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpWorkspace } from './helpers.js';

describe('PreviewManager', () => {
  it('tracks the detected port', () => {
    const p = new PreviewManager();
    expect(p.getPort()).toBeNull();
    p.setPort(1234);
    expect(p.getPort()).toBe(1234);
  });
  it('isUp reflects whether the target port is actually listening', async () => {
    const dir = await tmpWorkspace();
    await fs.writeFile(path.join(dir, 'index.html'), '<h1>up</h1>');
    const server = await startStaticServer(dir);
    const p = new PreviewManager();
    try {
      p.setPort(server.port);
      expect(await p.isUp()).toBe(true);
    } finally {
      await server.close();
    }
    expect(await p.isUp()).toBe(false); // server closed
  });
});

describe('checkPort', () => {
  it('is false for a port nothing listens on', async () => {
    expect(await checkPort(1, '127.0.0.1', 300)).toBe(false);
  });
});
