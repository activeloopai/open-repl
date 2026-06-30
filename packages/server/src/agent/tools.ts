import type { AgentTool } from '../providers/types.js';
import type { Workspace } from '../workspace.js';

export interface ToolDeps {
  workspace: Workspace;
  runCommand: (command: string) => Promise<{ code: number; output: string }>;
  commandAllowlist: string[];
  /** Start the app, observe, stop — the "run" half of the run-and-fix loop. */
  runApp: () => Promise<{ ok: boolean; url?: string; logs: string }>;
}

function allowed(command: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true; // empty = allow all (with banner in UI)
  return allowlist.some((prefix) => command.trim().startsWith(prefix));
}

export function buildTools(deps: ToolDeps): AgentTool[] {
  const { workspace } = deps;
  return [
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path relative to workspace root' } },
        required: ['path'],
      },
      async execute(args) {
        const content = await workspace.readFile(String(args.path));
        return { path: args.path, content: content.slice(0, 20000) };
      },
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a text file in the workspace. The user sees it update live.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
      async execute(args) {
        await workspace.writeFile(String(args.path), String(args.content ?? ''));
        return { ok: true, path: args.path };
      },
    },
    {
      name: 'list_dir',
      description: 'List files and folders in a workspace directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Defaults to "."' } },
      },
      async execute(args) {
        return { entries: await workspace.listDir(String(args.path ?? '.')) };
      },
    },
    {
      name: 'search_repo',
      description: 'Search file contents for a literal substring across the workspace.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      async execute(args) {
        return { matches: await workspace.search(String(args.query)) };
      },
    },
    {
      name: 'run_command',
      description: 'Run a shell command in the workspace and return its output. Use for installs, builds, tests.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
      async execute(args) {
        const command = String(args.command);
        if (!allowed(command, deps.commandAllowlist)) {
          return { error: `Command blocked by allowlist: ${command}` };
        }
        const { code, output } = await deps.runCommand(command);
        return { exitCode: code, output: output.slice(-8000) };
      },
    },
    {
      name: 'run_app',
      description:
        'Start the app and report whether it actually runs. Returns {ok:true,url} if it serves, or {ok:false,error} with the crash output/traceback. After writing code, call this to verify; if it fails, read the error, fix the files, and call run_app again until it runs.',
      parameters: { type: 'object', properties: {} },
      async execute() {
        const r = await deps.runApp();
        return r.ok ? { ok: true, url: r.url, note: 'app started successfully' } : { ok: false, error: r.logs };
      },
    },
  ];
}
