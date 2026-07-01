import { query, type Options, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { Message } from '@openrepl/shared';
import type { AgentEngine, EngineRun } from '../engine.js';
import type { RunResult } from '../../providers/types.js';
import { roles } from './roles.js';
import { buildOpenReplMcpServer, isCommandAllowed } from './tools.js';
import { toUiEvents, isResultMessage, extractResult } from './map-messages.js';

/**
 * ClaudeAgentEngine — runs a turn through `query()` from the Claude Agent SDK
 * (PRD §4). Native multi-agent: the main thread (orchestrator) delegates to the
 * planner/coder/reviewer subagents via the built-in `Agent` tool; the six
 * OpenREPL tools are exposed as an in-process MCP server so writes/commands/
 * run_app keep going through the live workspace plumbing (PRD §4.3).
 */

/** MCP server key → tools surface as `mcp__openrepl__<tool>`. */
const MCP_SERVER = 'openrepl';

/**
 * Tool split (see roles.ts): the orchestrator (main thread) does the file work
 * through the in-process MCP tools — reliable on the main thread — while the
 * read-only planner/reviewer subagents use the SDK's built-in tools (which work
 * inside delegated subagents, where the in-process MCP server does not).
 */
const MCP_TOOLS = ['read_file', 'write_file', 'list_dir', 'search_repo', 'run_command', 'run_app'] as const;
// Read-only built-ins for the advisory subagents. No built-in Bash/Write/Edit:
// the orchestrator does all mutation through the gated MCP tools, and a built-in
// Bash would let a "read-only" reviewer run shell commands under the default
// allow-all allowlist.
const BUILTIN_TOOLS = ['Read', 'Glob', 'Grep'] as const;
// Auto-approve the tools our roles use (no interactive prompt in headless mode).
// The per-role restriction (reviewer can't write, etc.) is enforced by each
// AgentDefinition.tools list, not here.
const allowedTools = ['Agent', ...BUILTIN_TOOLS, ...MCP_TOOLS.map((n) => `mcp__${MCP_SERVER}__${n}`)];

/** Read-only tools that are safe to dedupe: identical repeated calls add nothing. */
const READONLY_FOR_LOOP_GUARD = new Set(['Read', 'Glob', 'Grep', 'read_file', 'list_dir', 'search_repo']);
/** Only break a clearly-stuck loop, not legitimate re-reads during a fix cycle. */
const LOOP_LIMIT = 8;

/**
 * Permission gate: DEFAULT-ALLOW (so SDK-internal tools like TodoWrite are never
 * blocked), applying only two denials — the run_command allowlist and a stuck
 * read-only loop guard.
 *
 * Note: tools in `allowedTools` are auto-approved and skip canUseTool, so for a
 * normal run this gate mainly fires for the run_command allowlist. The real
 * loop mitigation is the orchestrator prompt ("avoid redundant inspection");
 * this guard is a backstop for any read-only call that does reach canUseTool.
 * A too-strict version (deny-unless-permitted) was reverted — it blocked the
 * SDK's own tools and stalled real runs.
 */
export function makeCanUseTool(allowlist: string[]): CanUseTool {
  const seen = new Map<string, number>();
  return async (toolName, input) => {
    const bare = toolName.replace(/^mcp__openrepl__/, '');
    if (bare === 'run_command') {
      const command = String((input as { command?: unknown }).command ?? '');
      if (!isCommandAllowed(command, allowlist)) {
        return { behavior: 'deny', message: `Command blocked by allowlist: ${command}` };
      }
    }
    if (READONLY_FOR_LOOP_GUARD.has(bare)) {
      const key = `${bare}:${JSON.stringify(input ?? {})}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > LOOP_LIMIT) {
        return {
          behavior: 'deny',
          message: `You already ran ${bare} with these exact arguments ${n - 1}×. The result has not changed — use the previous result and move on instead of repeating the call.`,
        };
      }
    }
    return { behavior: 'allow' };
  };
}

/**
 * Render the running history into a single prompt. `query()` is invoked once per
 * turn (session resume is future work — PRD §4.4), so prior turns are folded in
 * as a transcript preamble to preserve context.
 */
function renderPrompt(messages: Message[]): string {
  if (messages.length === 0) return '';
  const last = messages[messages.length - 1];
  const prior = messages.slice(0, -1);
  if (prior.length === 0) return last.content;
  const transcript = prior
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  return `Conversation so far:\n${transcript}\n\nUser: ${last.content}`;
}

export class ClaudeAgentEngine implements AgentEngine {
  async run(args: EngineRun): Promise<RunResult> {
    const { config, deps, signal, emit, runId } = args;

    // Bridge the session's signal to the SDK's own AbortController (PRD §4.4 —
    // keeps the Stop button killing in-flight Claude runs).
    const abortController = new AbortController();
    if (signal.aborted) abortController.abort();
    else signal.addEventListener('abort', () => abortController.abort(), { once: true });

    // Subscription is the default credential; an API key (if provided) is the
    // pay-as-you-go fallback and flips usage from plan-units to real $ (PRD §5).
    const flatSubscription = !args.apiKey;

    const agents = roles(config);

    const options: Options = {
      abortController,
      agents,
      // Make the orchestrator the main thread when the role map defines one.
      ...(agents.orchestrator ? { agent: 'orchestrator' } : {}),
      model: config.model,
      mcpServers: { [MCP_SERVER]: buildOpenReplMcpServer(deps) },
      // Anchor the SDK to the user's workspace: the subagents' built-in
      // Write/Edit/Bash tools operate relative to cwd, so this is what makes
      // their file writes land in the project (and chokidar then fires
      // file_changed for the live editor). Without it the SDK uses the server
      // process cwd and the app is written into the wrong directory.
      cwd: deps.workspace.root,
      // Isolate from any host config (PRD §4.3 / acceptance §6.6): settingSources
      // [] drops ~/.claude settings, strictMcpConfig ignores host/project
      // .mcp.json so ONLY our in-process openrepl server is connected, and
      // persistSession:false stops the SDK writing prompt/tool transcripts under
      // the host Claude config — project content stays inside the workspace.
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      allowedTools,
      canUseTool: makeCanUseTool(config.commandAllowlist),
      maxTurns: config.maxSteps,
      // The subprocess is Anthropic's own claude binary, which needs the host
      // env (PATH, HOME for the local credential). Inherit by omitting `env`
      // when running on the subscription; only set it to inject an explicit
      // ANTHROPIC_API_KEY for the pay-as-you-go path.
      ...(args.apiKey ? { env: { ...process.env, ANTHROPIC_API_KEY: args.apiKey } } : {}),
    };

    let finalText = '';
    let result: RunResult = { tokensIn: 0, tokensOut: 0, costUSD: null, planUnits: null, text: '' };

    try {
      for await (const msg of query({ prompt: renderPrompt(args.messages), options })) {
        for (const ev of toUiEvents(msg, runId)) {
          if (ev.type === 'agent_token') finalText += ev.text;
          emit(ev);
        }
        if (isResultMessage(msg)) {
          const r = extractResult(msg);
          const total = r.tokensIn + r.tokensOut;
          result = {
            tokensIn: r.tokensIn,
            tokensOut: r.tokensOut,
            costUSD: flatSubscription ? null : r.costUSD,
            planUnits: flatSubscription ? total : null,
            text: r.text || finalText,
          };
        }
      }
    } catch (e) {
      // The SDK throws on some terminal conditions (e.g. "Reached maximum
      // number of turns"). When the run was already productive — it streamed
      // output and/or did real work — record it instead of discarding the whole
      // turn (the user keeps the files written so far and a usage record). Only
      // a genuinely empty run propagates the error.
      if (signal.aborted || finalText || result.tokensOut > 0) {
        // Keep only real streamed text — never synthesize a placeholder, or
        // finishRun would persist a fake assistant message to memory for a
        // stop-before-any-output abort and poison the next turn's context.
        if (!result.text) result.text = finalText;
        return result;
      }
      throw e;
    }

    if (!result.text) result.text = finalText;
    return result;
  }
}
