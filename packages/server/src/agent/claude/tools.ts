/**
 * The six OpenREPL tools exposed as an in-process MCP server for the Claude
 * Agent SDK. We deliberately do NOT use the SDK's built-in Write/Bash: routing
 * every write through `workspace.writeFile`, every command through the existing
 * `CommandRunner`, and every app launch through `probeApp` is what keeps the
 * live editor sync, streamed terminal, and run_app self-healing loop working
 * (PRD §4.3). The handler logic mirrors `buildTools` in `agent/tools.ts`.
 */
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { ToolDeps } from '../tools.js';

/** MCP server name; tools are surfaced to the model as `mcp__openrepl__<name>`. */
export const MCP_SERVER_NAME = 'openrepl';

/** Full MCP tool name as the model and `allowedTools` must reference it. */
export const mcpToolName = (name: string): string => `mcp__${MCP_SERVER_NAME}__${name}`;

/**
 * Reject shell control operators so an allowed prefix cannot be used as a
 * springboard to a blocked command (`npm test && rm -rf /`, `npm; curl ...`,
 * backticks, `$(...)`, redirects, newlines). Only enforced when an allowlist is
 * active — an empty allowlist already means "allow all".
 */
const SHELL_OPERATORS = /[;&|`\n<>]|\$\(/;

/**
 * Single source of truth for run_command gating, shared by the MCP handler and
 * the engine's canUseTool (no duplicate predicate). Empty allowlist = allow all
 * (the UI shows a banner); otherwise the command must contain no shell operators
 * AND start with an allowed prefix.
 *
 * NOTE: this is a coarse prefix guard, not a sandbox. It blocks operator
 * chaining, but an allowed binary that can itself spawn a shell (e.g. allowing
 * `npm` still permits `npm exec -- sh -c ...`, allowing `bash` permits `bash -c
 * ...`) can escape the intent. True isolation needs OS-level sandboxing, which
 * OpenREPL deliberately defers (it runs locally, no Docker). Treat the allowlist
 * as defense-in-depth, and only relax it to binaries you trust to not re-shell.
 */
export function isCommandAllowed(command: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  const trimmed = command.trim();
  if (SHELL_OPERATORS.test(trimmed)) return false;
  // Match on a command boundary: an allowed prefix must be the whole command or
  // be followed by whitespace, so `npm` does not also permit `npmx` and
  // `npm test` does not permit `npm test2`.
  return allowlist.some((prefix) => {
    if (!trimmed.startsWith(prefix)) return false;
    const next = trimmed.charAt(prefix.length);
    return next === '' || next === ' ' || next === '\t';
  });
}

/** Wrap a plain result object as an MCP CallToolResult (text content). */
function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

/**
 * The tool handlers, extracted from the MCP wiring so they can be unit-tested
 * directly over a real Workspace (buildOpenReplMcpServer just wraps these with
 * `tool()`). Each returns the MCP CallToolResult shape.
 */
export function openReplToolHandlers(deps: ToolDeps) {
  const { workspace } = deps;
  return {
    read_file: async (args: { path: string }) => {
      const content = await workspace.readFile(args.path);
      return result({ path: args.path, content: content.slice(0, 20000) });
    },
    write_file: async (args: { path: string; content?: string }) => {
      await workspace.writeFile(args.path, args.content ?? '');
      return result({ ok: true, path: args.path });
    },
    list_dir: async (args: { path?: string }) => {
      return result({ entries: await workspace.listDir(args.path ?? '.') });
    },
    search_repo: async (args: { query: string }) => {
      return result({ matches: await workspace.search(args.query) });
    },
    run_command: async (args: { command: string }) => {
      if (!isCommandAllowed(args.command, deps.commandAllowlist)) {
        return result({ error: `Command blocked by allowlist: ${args.command}` });
      }
      const { code, output } = await deps.runCommand(args.command);
      return result({ exitCode: code, output: output.slice(-8000) });
    },
    run_app: async () => {
      const r = await deps.runApp();
      return result(r.ok ? { ok: true, url: r.url, note: 'app started successfully' } : { ok: false, error: r.logs });
    },
  };
}

export function buildOpenReplMcpServer(deps: ToolDeps) {
  const h = openReplToolHandlers(deps);
  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    tools: [
      tool('read_file', 'Read a UTF-8 text file from the workspace.', { path: z.string().describe('Path relative to workspace root') }, h.read_file),
      tool('write_file', 'Create or overwrite a text file in the workspace. The user sees it update live.', { path: z.string(), content: z.string() }, h.write_file),
      tool('list_dir', 'List files and folders in a workspace directory.', { path: z.string().optional().describe('Defaults to "."') }, h.list_dir),
      tool('search_repo', 'Search file contents for a literal substring across the workspace.', { query: z.string() }, h.search_repo),
      tool('run_command', 'Run a shell command in the workspace and return its output. Use for installs, builds, tests.', { command: z.string() }, h.run_command),
      tool(
        'run_app',
        'Start the app and report whether it actually runs. Returns {ok:true,url} if it serves, or {ok:false,error} with the crash output/traceback. After writing code, call this to verify; if it fails, read the error, fix the files, and call run_app again until it runs.',
        {},
        h.run_app,
      ),
    ],
  });
}
