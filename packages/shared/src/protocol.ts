/**
 * OpenREPL WebSocket protocol — single source of truth shared by server & web.
 *
 * Discriminated unions on `type`. Rule (see IMPLEMENTATION.md §4):
 * NO file state inside agent events. The agent writes to the filesystem,
 * chokidar is the ONLY notifier of file changes. This avoids the race between
 * "agent said it wrote" and "the file is actually there".
 */

export type FileKind = 'add' | 'change' | 'unlink';

/** A single process in a run workflow (e.g. "backend", "frontend"). */
export interface WorkflowStep {
  name: string;
  /** Shell command to run. Omitted for a static-file step. */
  command?: string;
  /** Serve the workspace statically instead of running a command. */
  static?: boolean;
  /** This step's dev-server is what the Preview should point at. */
  preview?: boolean;
}

/** A named run configuration — like Replit/Lovable workflows. Runs steps together. */
export interface Workflow {
  name: string;
  steps: WorkflowStep[];
}

/** A project = a folder the user works in. OpenREPL tracks a list of them. */
export interface Project {
  name: string;
  path: string;
  lastOpened: number;
}

export interface FileTreeNode {
  path: string; // relative to workspace root
  name: string;
  type: 'file' | 'dir';
  children?: FileTreeNode[];
}

export type ProviderId = 'openrouter' | 'codex';

/** Roles that can each be assigned their own model. 'default' is the fallback. */
export type AgentRole = 'default' | 'orchestrator' | 'planner' | 'coder' | 'reviewer';

export const AGENT_ROLES: AgentRole[] = ['default', 'orchestrator', 'planner', 'coder', 'reviewer'];

export interface ModelInfo {
  id: string;
  name: string;
  /** USD per 1M prompt tokens, when known. */
  promptUsdPerM?: number;
  /** USD per 1M completion tokens, when known. */
  completionUsdPerM?: number;
}

export interface UsageRecord {
  runId: string;
  provider: ProviderId;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Real $ cost when known (OpenRouter). Null for flat-subscription providers (Codex). */
  costUSD: number | null;
  /** Flat-subscription "plan units" when no $ applies (Codex). Null otherwise. */
  planUnits: number | null;
  ts: number;
}

/* ----------------------------- Server -> Client ---------------------------- */

export type UiEvent =
  | { type: 'ready'; workspaceDir: string; provider: ProviderId }
  | { type: 'tree'; nodes: FileTreeNode[] }
  | { type: 'file_changed'; path: string; kind: FileKind }
  | { type: 'file_content'; path: string; content: string }
  | { type: 'agent_start'; runId: string }
  | { type: 'agent_token'; runId: string; text: string }
  | { type: 'agent_tool_call'; runId: string; id: string; name: string; args: unknown }
  | { type: 'agent_tool_result'; runId: string; id: string; result: unknown }
  | { type: 'term_data'; data: string }
  | { type: 'term_exit'; code: number }
  | { type: 'preview_ready'; url: string }
  | { type: 'app_status'; state: 'installing' | 'starting' | 'running' | 'stopped' | 'error'; message?: string }
  | { type: 'workflows'; workflows: Workflow[]; active: string | null }
  | { type: 'provider_status'; provider: ProviderId; state: 'ok' | 'fallback' | 'error'; message?: string }
  | { type: 'usage_update'; record: UsageRecord }
  | { type: 'secrets'; keys: string[] }
  | { type: 'projects'; projects: Project[]; active: string | null; defaultRoot: string }
  | { type: 'models'; models: ModelInfo[] }
  | { type: 'model_config'; default: string; roles: Partial<Record<AgentRole, string>>; multiAgent: boolean }
  | { type: 'error'; scope: string; message: string }
  | { type: 'done'; runId: string };

/* ----------------------------- Client -> Server ---------------------------- */

export type ClientCommand =
  | { type: 'list_tree' }
  | { type: 'open_file'; path: string }
  | { type: 'save_file'; path: string; content: string }
  | { type: 'send_message'; text: string }
  | { type: 'stop'; runId: string }
  | { type: 'term_input'; data: string }
  | { type: 'term_resize'; cols: number; rows: number }
  | { type: 'run_command'; command: string }
  | { type: 'run_app' }
  | { type: 'stop_app' }
  | { type: 'list_workflows' }
  | { type: 'run_workflow'; name?: string }
  | { type: 'list_projects' }
  | { type: 'create_project'; name: string; path?: string }
  | { type: 'open_project'; path: string }
  | { type: 'set_provider'; provider: ProviderId }
  | { type: 'set_secret'; key: string; value: string }
  | { type: 'delete_secret'; key: string }
  | { type: 'list_secrets' }
  | { type: 'get_usage' }
  | { type: 'list_models' }
  | { type: 'set_model'; role: AgentRole; model: string }
  | { type: 'set_multi_agent'; enabled: boolean };

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
