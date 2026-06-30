import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Project } from '@openrepl/shared';

/**
 * Tracks the user's projects (each a folder, possibly anywhere). The list lives
 * in a registry JSON file; new projects default under `defaultRoot` but the user
 * can pass any path. Most-recently-opened first.
 */
export class ProjectRegistry {
  constructor(
    private registryPath: string,
    public readonly defaultRoot: string,
  ) {}

  async list(): Promise<Project[]> {
    try {
      const raw = await fs.readFile(this.registryPath, 'utf8');
      const parsed = JSON.parse(raw);
      const projects: Project[] = Array.isArray(parsed?.projects) ? parsed.projects : [];
      // drop entries whose folder no longer exists
      const alive = await Promise.all(projects.map(async (p) => ((await exists(p.path)) ? p : null)));
      return alive.filter((p): p is Project => p !== null).sort((a, b) => b.lastOpened - a.lastOpened);
    } catch {
      return [];
    }
  }

  /** Create a new project folder and register it. */
  async create(name: string, customPath?: string, now = Date.now()): Promise<Project> {
    const clean = name.trim();
    if (!clean) throw new Error('Project name required');
    const dir = customPath ? path.resolve(customPath) : path.join(this.defaultRoot, slug(clean));
    await fs.mkdir(dir, { recursive: true });
    const project: Project = { name: clean, path: dir, lastOpened: now };
    await this.upsert(project);
    return project;
  }

  /** Register/open an existing folder. */
  async open(dir: string, now = Date.now()): Promise<Project> {
    const resolved = path.resolve(dir);
    if (!(await exists(resolved))) throw new Error(`Folder does not exist: ${resolved}`);
    const existing = (await this.list()).find((p) => p.path === resolved);
    const project: Project = { name: existing?.name ?? path.basename(resolved), path: resolved, lastOpened: now };
    await this.upsert(project);
    return project;
  }

  private async upsert(project: Project): Promise<void> {
    const list = (await this.list()).filter((p) => p.path !== project.path);
    list.unshift(project);
    await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
    await fs.writeFile(this.registryPath, JSON.stringify({ projects: list }, null, 2));
  }
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
