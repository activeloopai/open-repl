import { describe, it, expect } from 'vitest';
import { Workspace } from '../src/workspace.js';
import { tmpWorkspace } from './helpers.js';

describe('Workspace', () => {
  it('writes, reads and lists files', async () => {
    const ws = new Workspace(await tmpWorkspace());
    await ws.writeFile('a/b.txt', 'hello');
    expect(await ws.readFile('a/b.txt')).toBe('hello');
    const entries = await ws.listDir('a');
    expect(entries).toEqual([{ name: 'b.txt', type: 'file' }]);
  });

  it('builds a nested tree and ignores node_modules', async () => {
    const ws = new Workspace(await tmpWorkspace());
    await ws.writeFile('src/index.ts', '1');
    await ws.writeFile('node_modules/dep/x.js', '2');
    const tree = await ws.tree();
    const names = tree.map((n) => n.name);
    expect(names).toContain('src');
    expect(names).not.toContain('node_modules');
  });

  it('refuses paths that escape the workspace root', async () => {
    const ws = new Workspace(await tmpWorkspace());
    await expect(ws.readFile('../../etc/passwd')).rejects.toThrow(/escapes workspace/);
    expect(() => ws.resolve('../outside')).toThrow();
  });

  it('searches file contents', async () => {
    const ws = new Workspace(await tmpWorkspace());
    await ws.writeFile('one.txt', 'find me here\nnot here');
    await ws.writeFile('two.txt', 'nothing');
    const matches = await ws.search('find me');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ path: 'one.txt', line: 1 });
  });
});
