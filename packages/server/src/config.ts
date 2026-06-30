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
  // Claude Agent SDK is the default: native multi-agent, subscription-first auth
  // (PRD §4.1 / §5). Switch to OpenRouter/Codex in the Models tab.
  provider: 'claude',
  // Default model tier (SDK alias) used when a role has no explicit tier.
  model: 'sonnet',
  // Per-role model tiers (PRD §4.2): Haiku for the cheap read-only planner,
  // Sonnet for the reviewer, Opus for the orchestrator (which does the coding —
  // see agent/claude/roles.ts). Config-overridable per role.
  models: {
    orchestrator: 'opus',
    planner: 'haiku',
    reviewer: 'sonnet',
  },
  // A full multi-agent build (plan → code → pip install → run → fix → review)
  // needs headroom; 20 turns truncated real Flask builds mid-flow.
  maxSteps: 50,
  maxTokens: 100_000,
  commandAllowlist: [],
  multiAgent: true,
};

/**
 * Provider-appropriate default model + per-role tiers. The defaults above are
 * Claude SDK aliases (`sonnet`/`opus`/`haiku`); those are NOT valid model ids
 * for OpenRouter/Codex, so switching provider must also swap the model defaults
 * (see Session `set_provider`) — otherwise an OpenRouter run would be sent the
 * literal string "sonnet".
 */
export const PROVIDER_DEFAULTS: Record<ProviderId, Pick<OpenReplConfig, 'model' | 'models'>> = {
  claude: { model: 'sonnet', models: { orchestrator: 'opus', planner: 'haiku', reviewer: 'sonnet' } },
  openrouter: {
    model: 'anthropic/claude-sonnet-4.6',
    models: {
      orchestrator: 'anthropic/claude-sonnet-4.6',
      planner: 'google/gemini-2.5-flash',
      reviewer: 'anthropic/claude-sonnet-4.6',
    },
  },
  codex: { model: 'gpt-5.1', models: {} },
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
