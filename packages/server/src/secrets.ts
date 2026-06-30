import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Secrets manager backed by a .env file in the workspace root (chmod 600).
 * Injected into run_command / terminal / preview child processes.
 */
export class Secrets {
  private file: string;
  private values: Record<string, string> = {};
  private loaded = false;

  constructor(workspaceDir: string) {
    this.file = path.join(workspaceDir, '.env');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.values = parseEnv(raw);
    } catch {
      this.values = {};
    }
    this.loaded = true;
  }

  async keys(): Promise<string[]> {
    await this.load();
    return Object.keys(this.values);
  }

  async all(): Promise<Record<string, string>> {
    await this.load();
    return { ...this.values };
  }

  async set(key: string, value: string): Promise<void> {
    await this.load();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`);
    this.values[key] = value;
    await this.persist();
  }

  async remove(key: string): Promise<void> {
    await this.load();
    delete this.values[key];
    await this.persist();
  }

  private async persist(): Promise<void> {
    const body = Object.entries(this.values)
      .map(([k, v]) => `${k}=${serializeValue(v)}`)
      .join('\n');
    await fs.writeFile(this.file, body + (body ? '\n' : ''), { mode: 0o600 });
  }
}

export function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function serializeValue(v: string): string {
  return /[\s#"']/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}
