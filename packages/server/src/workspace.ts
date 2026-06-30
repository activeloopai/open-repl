import { promises as fs } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { FileKind, FileTreeNode } from '@openrepl/shared';

const IGNORED = new Set(['node_modules', '.git', '.openrepl', 'dist', 'coverage', '.DS_Store']);

function isIgnored(rel: string): boolean {
  return rel.split(path.sep).some((seg) => IGNORED.has(seg));
}

/**
 * Filesystem-scoped workspace. The FS is the single source of truth;
 * the UI derives its state from `file_changed` events emitted by the watcher.
 */
export class Workspace {
  readonly root: string;
  private watcher: FSWatcher | null = null;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolve a relative path safely, refusing anything that escapes the root. */
  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel);
    const relCheck = path.relative(this.root, abs);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      throw new Error(`Path escapes workspace: ${rel}`);
    }
    return abs;
  }

  async readFile(rel: string): Promise<string> {
    return fs.readFile(this.resolve(rel), 'utf8');
  }

  async writeFile(rel: string, content: string): Promise<void> {
    const abs = this.resolve(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  async listDir(rel: string): Promise<{ name: string; type: 'file' | 'dir' }[]> {
    const entries = await fs.readdir(this.resolve(rel), { withFileTypes: true });
    return entries
      .filter((e) => !IGNORED.has(e.name))
      .map((e) => ({ name: e.name, type: e.isDirectory() ? ('dir' as const) : ('file' as const) }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }

  async tree(rel = '.', depth = 6): Promise<FileTreeNode[]> {
    if (depth < 0) return [];
    const entries = await this.listDir(rel);
    const nodes: FileTreeNode[] = [];
    for (const e of entries) {
      const childRel = path.join(rel === '.' ? '' : rel, e.name);
      const node: FileTreeNode = { path: childRel, name: e.name, type: e.type };
      if (e.type === 'dir') node.children = await this.tree(childRel, depth - 1);
      nodes.push(node);
    }
    return nodes;
  }

  /** Recursively search file contents for a literal substring. */
  async search(query: string, max = 50): Promise<{ path: string; line: number; text: string }[]> {
    const out: { path: string; line: number; text: string }[] = [];
    const walk = async (rel: string) => {
      if (out.length >= max) return;
      for (const e of await this.listDir(rel)) {
        if (out.length >= max) return;
        const childRel = path.join(rel === '.' ? '' : rel, e.name);
        if (e.type === 'dir') {
          await walk(childRel);
        } else {
          try {
            const content = await this.readFile(childRel);
            content.split('\n').forEach((text, i) => {
              if (out.length < max && text.includes(query)) out.push({ path: childRel, line: i + 1, text: text.trim() });
            });
          } catch {
            /* binary / unreadable — skip */
          }
        }
      }
    };
    await walk('.');
    return out;
  }

  watch(onChange: (path: string, kind: FileKind) => void): void {
    this.watcher = chokidar.watch(this.root, {
      ignoreInitial: true,
      ignored: (p: string) => isIgnored(path.relative(this.root, p)),
    });
    const rel = (p: string) => path.relative(this.root, p);
    this.watcher
      .on('add', (p) => onChange(rel(p), 'add'))
      .on('change', (p) => onChange(rel(p), 'change'))
      .on('unlink', (p) => onChange(rel(p), 'unlink'))
      .on('addDir', (p) => onChange(rel(p), 'add'))
      .on('unlinkDir', (p) => onChange(rel(p), 'unlink'));
  }

  async close(): Promise<void> {
    await this.watcher?.close();
  }
}
