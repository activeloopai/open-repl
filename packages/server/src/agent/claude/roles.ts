/**
 * Roles for the Claude Agent SDK engine (PRD §4.2), shaped by what the real-run
 * e2e proved reliable.
 *
 * Hard lesson from the e2e: an in-process `createSdkMcpServer` is only reachable
 * from the MAIN thread. A delegated subagent that tries to WRITE files is
 * unreliable — its MCP calls come back "Stream closed", and even with built-in
 * tools its multi-file writes land non-deterministically (one run builds and
 * serves the app, the next writes nothing). Read-only subagents that just return
 * text are fine.
 *
 * So the reliable shape is:
 *   - the ORCHESTRATOR is the lead engineer: it does the file work itself through
 *     the in-process MCP tools (write_file/run_command/run_app — these go through
 *     workspace.writeFile + probeApp and fire the live-editor watcher), which is
 *     deterministic on the main thread;
 *   - the PLANNER and REVIEWER are read-only advisory subagents (built-in
 *     Read/Glob/Grep[/Bash]); their output is text, so async delegation can't
 *     corrupt file state.
 *
 * Model tiers encode the user's intent: Haiku for the cheap planner, Sonnet for
 * the reviewer, Opus for the orchestrator (which does the heavy coding). All are
 * config-overridable per role via `cfg.models`.
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRole } from '@openrepl/shared';
import { mcpToolName } from './tools.js';

type Role = Exclude<AgentRole, 'default'>;

/** Default model tier per role (PRD §4.2, adjusted: the orchestrator codes). */
const DEFAULT_TIERS: Partial<Record<Role, string>> = {
  orchestrator: 'opus',
  planner: 'haiku',
  reviewer: 'sonnet',
};

export interface RolesConfig {
  /** Per-role model overrides (same shape as `OpenReplConfig.models`). */
  models?: Partial<Record<Role, string>>;
}

/** Resolve the model tier for a role, honoring config overrides. */
function modelFor(cfg: RolesConfig, role: Role): string {
  return cfg.models?.[role] || DEFAULT_TIERS[role] || 'sonnet';
}

/* The orchestrator codes via the in-process MCP tools (reliable on the main
 * thread); read-only subagents use built-in tools (no file mutation). */
const ORCHESTRATOR_TOOLS = [
  'Agent',
  ...['read_file', 'write_file', 'list_dir', 'search_repo', 'run_command', 'run_app'].map(mcpToolName),
];
const READONLY_BUILTIN = ['Read', 'Glob', 'Grep'];
const REVIEWER_BUILTIN = ['Read', 'Glob', 'Grep', 'Bash'];

const PLANNER_PROMPT =
  'You are the Planner. Inspect the workspace with Read, Glob, and Grep and return a short, ' +
  'concrete, ordered plan to accomplish the task. Do NOT write files. Be terse — bullet steps only.';

const REVIEWER_PROMPT =
  'You are the Reviewer. Inspect the changes with Read, Glob, and Grep for correctness and obvious ' +
  'quality issues, and report concise findings. You may use Bash for read-only checks. Do NOT edit files.';

const ORCHESTRATOR_PROMPT =
  'You are the lead engineer coordinating a small team. ' +
  'First, delegate a brief plan to the planner subagent (read-only) via the Agent tool. ' +
  'Then IMPLEMENT the plan YOURSELF: create and edit files with write_file, run commands with run_command, ' +
  'and after writing code you MUST call run_app to verify the app actually runs. ' +
  'If run_app returns ok:false, read the error/traceback, fix the file(s), and call run_app again — ' +
  'repeat until it returns ok:true. Do the coding yourself; do NOT delegate file edits. ' +
  'Then delegate a review to the reviewer subagent (read-only) and address any critical findings. ' +
  'Never declare success while run_app is failing. When it runs, give the user a short summary and confirm the app runs.';

/**
 * Build the role → `AgentDefinition` map. The orchestrator is the main thread
 * (it holds the in-process MCP tools and does the coding); planner and reviewer
 * are read-only advisory subagents.
 */
export function roles(cfg: RolesConfig = {}): Record<string, AgentDefinition> {
  return {
    orchestrator: {
      description: 'Lead engineer: plans with the planner, implements the code itself, verifies via run_app, then has the reviewer check it.',
      prompt: ORCHESTRATOR_PROMPT,
      tools: ORCHESTRATOR_TOOLS,
      model: modelFor(cfg, 'orchestrator'),
    },
    planner: {
      description: 'Reads the codebase and produces a concise, concrete step-by-step plan. Read-only.',
      prompt: PLANNER_PROMPT,
      tools: READONLY_BUILTIN,
      model: modelFor(cfg, 'planner'),
    },
    reviewer: {
      description: 'Independently reviews the changes for correctness and quality. Read-only.',
      prompt: REVIEWER_PROMPT,
      tools: REVIEWER_BUILTIN,
      model: modelFor(cfg, 'reviewer'),
    },
  };
}
