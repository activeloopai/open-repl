import { describe, it, expect } from 'vitest';
import { PreviewManager, checkPort, pickPreview, rewritePreviewHtml, type PreviewSource } from '../src/preview.js';
import { startStaticServer } from '../src/static-server.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpWorkspace } from './helpers.js';

/** A mounted session: has a PreviewManager, with a detected port or not. */
function mounted(port: number | null): PreviewSource {
  const preview = new PreviewManager();
  if (port != null) preview.setPort(port);
  return { getPreview: () => preview };
}
/** An unmounted session: no project open yet, so no preview at all. */
function unmounted(): PreviewSource {
  return { getPreview: () => null };
}

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

describe('rewritePreviewHtml', () => {
  it('prefixes root-absolute href/src/action so links stay in the preview', () => {
    const out = rewritePreviewHtml(
      '<link href="/static/app.css"><a href="/add">x</a><form action="/">',
    );
    expect(out).toContain('href="/__preview/static/app.css"');
    expect(out).toContain('href="/__preview/add"');
    expect(out).toContain('action="/__preview/"');
  });

  it('rewrites url(/...) in inline styles', () => {
    expect(rewritePreviewHtml('background:url(/bg.png)')).toContain('url(/__preview/bg.png)');
  });

  it('leaves absolute and protocol-relative URLs untouched', () => {
    const html = '<a href="https://x.com/y">a</a><script src="//cdn/z.js"></script><a href="rel">r</a>';
    expect(rewritePreviewHtml(html)).toBe(html);
  });
});

describe('pickPreview', () => {
  it('prefers the session whose app is running over the newest connection', () => {
    const withApp = mounted(5000);
    const current = mounted(null);
    expect(pickPreview([withApp, current], current)?.getPort()).toBe(5000);
  });

  it('falls back to the current session when no app has a port yet', () => {
    const current = mounted(null);
    const chosen = pickPreview([current], current);
    expect(chosen).toBe(current.getPreview());
    expect(chosen?.getPort()).toBeNull();
  });

  it('returns null when the current session has no project mounted', () => {
    const current = unmounted();
    expect(pickPreview([current], current)).toBeNull();
  });

  it('returns null when there are no sessions and no current', () => {
    expect(pickPreview([], null)).toBeNull();
  });

  it('a second connection cannot steal the proxy from the running app', () => {
    const a = mounted(5000);
    const b = unmounted();
    expect(pickPreview([a, b], b)?.getPort()).toBe(5000);
  });
});
