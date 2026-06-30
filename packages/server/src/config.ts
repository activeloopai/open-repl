import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProviderId, AgentRole } from '@openrepl/shared';

/**
 * Config + memory live INSIDE the workspace under ./.openrepl (never in $HOME),
 * per the hard constraint "no files outside the project folder".
 */

export interface OpenReplConfig {
  provider: ProviderId;
  /** Default model, used when a role has no specific override. */
  model: string;
  /** Per-role model overrides (orchestrator / planner / coder / reviewer). */
  models: Partial<Record<Exclude<AgentRole, 'default'>, string>>;
  /** Per-run budget guard. */
  maxSteps: number;
  maxTokens: number;
  /** Allowlist prefixes for run_command (empty = allow all, with a warning). */
  commandAllowlist: string[];
  /** Use the multi-agent orchestrator (planner/coder/reviewer) for real providers. */
  multiAgent: boolean;
}

export const DEFAULT_CONFIG: OpenReplConfig = {
  provider: 'openrouter',
  // Single-agent default + fallback: a capable all-rounder (NOT gpt-4o-mini).
  model: 'anthropic/claude-sonnet-4.6',
  // Per-role defaults we pick: cheap+reliable orchestrator, fast execution models.
  // (Tunable in the Models tab; presets eco/medium/high are on the roadmap.)
  models: {
    orchestrator: 'openai/gpt-5-mini',
    planner: 'google/gemini-2.5-flash',
    coder: 'google/gemini-2.5-flash',
    reviewer: 'google/gemini-2.5-flash',
  },
  maxSteps: 20,
  maxTokens: 100_000,
  commandAllowlist: [],
  multiAgent: true,
};

/** Resolve the model for a role, falling back to the default model. */
export function modelFor(config: OpenReplConfig, role?: Exclude<AgentRole, 'default'>): string {
  return (role && config.models[role]) || config.model;
}

export function dotDir(workspaceDir: string): string {
  return path.join(workspaceDir, '.openrepl');
}

export function configPath(workspaceDir: string): string {
  return path.join(dotDir(workspaceDir), 'config.json');
}

export async function ensureDotDir(workspaceDir: string): Promise<string> {
  const dir = dotDir(workspaceDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function loadConfig(workspaceDir: string): Promise<OpenReplConfig> {
  try {
    const raw = await fs.readFile(configPath(workspaceDir), 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(workspaceDir: string, config: OpenReplConfig): Promise<void> {
  await ensureDotDir(workspaceDir);
  await fs.writeFile(configPath(workspaceDir), JSON.stringify(config, null, 2), { mode: 0o600 });
}
