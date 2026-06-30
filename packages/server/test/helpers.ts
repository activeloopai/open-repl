import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/**
 * Temp workspaces are created INSIDE the project (./.test-tmp), never in /tmp,
 * to respect the hard constraint "no files outside the project folder".
 */
export async function tmpWorkspace(): Promise<string> {
  const dir = path.resolve(process.cwd(), '.test-tmp', randomUUID());
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
