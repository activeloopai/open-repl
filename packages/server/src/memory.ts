import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ensureDotDir, dotDir } from './config.js';
import type { Message } from '@openrepl/shared';

/**
 * Persistent conversation memory, JSON-file based, scoped per workspace.
 * Lives in ./.openrepl/memory.json (inside the workspace — never $HOME).
 * Upgrade path (documented): swap this for Mastra Memory + LibSQL with
 * semantic recall. The interface below is deliberately tiny so the swap is local.
 */

const MAX_PERSISTED = 200;

export class Memory {
  private file: string;
  private messages: Message[] = [];
  private loaded = false;

  constructor(workspaceDir: string) {
    this.file = path.join(dotDir(workspaceDir), 'memory.json');
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.messages)) this.messages = parsed.messages;
    } catch {
      this.messages = [];
    }
    this.loaded = true;
  }

  history(): Message[] {
    return this.messages;
  }

  async append(message: Message): Promise<void> {
    await this.load();
    this.messages.push(message);
    if (this.messages.length > MAX_PERSISTED) {
      this.messages = this.messages.slice(-MAX_PERSISTED);
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ messages: this.messages }, null, 2));
  }

  async clear(): Promise<void> {
    this.messages = [];
    await this.persist();
  }

  // ensureDotDir is awaited lazily through persist(); referenced to keep the
  // import meaningful for callers that want to pre-create the directory.
  static async prepare(workspaceDir: string): Promise<void> {
    await ensureDotDir(workspaceDir);
  }
}
