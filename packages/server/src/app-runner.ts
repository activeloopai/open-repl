import { promises as fs } from 'node:fs';
import path from 'node:path';

export type RunKind = 'npm-dev' | 'npm-start' | 'static' | 'self' | 'none';

export interface RunPlan {
  kind: RunKind;
  /** Shell command to start a dev server (for npm-* kinds). */
  command?: string;
  /** True when node_modules is missing and `npm install` should run first. */
  needsInstall: boolean;
  /** Human description shown in the UI. */
  description: string;
}

/**
 * Decide how to run the user's app, so a non-technical user just clicks "Run".
 *  - package.json with a `dev` script  → npm run dev
 *  - package.json with a `start` script → npm start
 *  - an index.html anywhere near the root → serve statically
 *  - otherwise → nothing runnable
 */
export async function detectRunPlan(workspaceDir: string): Promise<RunPlan> {
  const pkgPath = path.join(workspaceDir, 'package.json');
  let pkg: any = null;
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  } catch {
    /* no package.json */
  }

  // Guard: never "run" OpenREPL itself — that would launch OpenREPL inside the
  // preview (recursion). Tell the user to open their app's folder instead.
  if (pkg && isOpenReplItself(pkg)) {
    return { kind: 'self', needsInstall: false, description: 'OpenREPL itself' };
  }

  if (pkg?.scripts) {
    const needsInstall = !(await exists(path.join(workspaceDir, 'node_modules')));
    const scriptName = pkg.scripts.dev ? 'dev' : pkg.scripts.start ? 'start' : null;
    if (scriptName) {
      const cmd = String(pkg.scripts[scriptName]);
      if (launchesOpenRepl(cmd)) return { kind: 'self', needsInstall: false, description: 'OpenREPL itself' };
      const command = scriptName === 'dev' ? 'npm run dev' : 'npm start';
      return { kind: scriptName === 'dev' ? 'npm-dev' : 'npm-start', command, needsInstall, description: command };
    }
  }

  if (await exists(path.join(workspaceDir, 'index.html'))) {
    return { kind: 'static', needsInstall: false, description: 'serve static index.html' };
  }

  return { kind: 'none', needsInstall: false, description: 'no runnable app found' };
}

/** Detect whether a package.json is OpenREPL's own (to avoid recursive launch). */
function isOpenReplItself(pkg: any): boolean {
  const name = String(pkg?.name ?? '');
  if (name === 'openrepl' || name === 'openrepl-monorepo') return true;
  if (pkg?.bin && typeof pkg.bin === 'object' && 'openrepl' in pkg.bin) return true;
  if (Array.isArray(pkg?.workspaces) && pkg.workspaces.some((w: string) => w.includes('packages/cli'))) return true;
  return false;
}

/** Heuristic: a script that boots the OpenREPL CLI. */
function launchesOpenRepl(cmd: string): boolean {
  return /packages\/cli|\bopenrepl\b/.test(cmd);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
