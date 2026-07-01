import { randomUUID } from 'node:crypto';
import type { ClientCommand, UiEvent, ProviderId, Workflow } from '@openrepl/shared';
import { Workspace } from './workspace.js';
import { Memory } from './memory.js';
import { UsageStore, makeUsageRecord } from './usage.js';
import { Secrets } from './secrets.js';
import { CommandRunner, detectPort } from './runner.js';
import { PreviewManager } from './preview.js';
import { detectWorkflows, WorkflowManager } from './workflow.js';
import { ProviderRegistry } from './providers/registry.js';
import { ProjectRegistry } from './projects.js';
import { buildTools, type ToolDeps } from './agent/tools.js';
import { probeApp } from './agent/probe.js';
import { runMultiAgent } from './agent/orchestrator.js';
import { ClaudeAgentEngine } from './agent/claude/engine.js';
import { BudgetGuard } from './agent/guards.js';
import type { AgentRun, ModelProvider } from './providers/types.js';
import { runRole } from './agent/runtime.js';
import { listModels } from './providers/models.js';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, type OpenReplConfig } from './config.js';

/** Everything bound to one open project. Null when no project is open. */
interface Mount {
  dir: string;
  workspace: Workspace;
  memory: Memory;
  usage: UsageStore;
  secrets: Secrets;
  registry: ProviderRegistry;
  shell: CommandRunner;
  preview: PreviewManager;
  config: OpenReplConfig;
  workflowMgr: WorkflowManager | null;
  workflows: Workflow[];
  activeWorkflow: string | null;
}

/** One session per WebSocket connection. The active project can be switched at runtime. */
export class Session {
  private mount: Mount | null = null;
  private activeRun: AbortController | null = null;

  constructor(
    private emit: (event: UiEvent) => void,
    private projects: ProjectRegistry,
  ) {}

  getPreview(): PreviewManager | null {
    return this.mount?.preview ?? null;
  }

  async init(): Promise<void> {
    await this.sendProjects();
    // Auto-open the most recently used project, if any; else show the projects menu.
    const list = await this.projects.list();
    if (list.length) await this.openProject(list[0].path);
  }

  async handle(cmd: ClientCommand): Promise<void> {
    try {
      // Project commands work without an open project.
      switch (cmd.type) {
        case 'list_projects':
          return void (await this.sendProjects());
        case 'create_project': {
          const p = await this.projects.create(cmd.name, cmd.path);
          return void (await this.openProject(p.path));
        }
        case 'open_project':
          return void (await this.openProject(cmd.path));
      }

      const m = this.mount;
      if (!m) return this.emit({ type: 'error', scope: cmd.type, message: 'No project open. Create or select one first.' });

      switch (cmd.type) {
        case 'list_tree':
          return this.emit({ type: 'tree', nodes: await m.workspace.tree() });
        case 'open_file':
          return this.emit({ type: 'file_content', path: cmd.path, content: await m.workspace.readFile(cmd.path) });
        case 'save_file':
          return void (await m.workspace.writeFile(cmd.path, cmd.content));
        case 'send_message':
          return void (await this.runAgent(m, cmd.text));
        case 'stop':
          this.activeRun?.abort();
          return;
        case 'term_input':
          return m.shell.input(cmd.data);
        case 'term_resize':
          return m.shell.resize(cmd.cols, cmd.rows);
        case 'run_command':
          await m.shell.run(cmd.command);
          return;
        case 'run_app':
          return void (await this.runWorkflow(m));
        case 'stop_app':
          return void (await this.stopWorkflow(m));
        case 'list_workflows':
          return void (await this.sendWorkflows(m));
        case 'run_workflow':
          return void (await this.runWorkflow(m, cmd.name));
        case 'set_provider': {
          m.config.provider = cmd.provider;
          // Swap to provider-appropriate model defaults: the Claude SDK aliases
          // (sonnet/opus/haiku) are not valid OpenRouter/Codex model ids, so a
          // bare provider switch would otherwise send "sonnet" to OpenRouter.
          const defaults = PROVIDER_DEFAULTS[cmd.provider];
          if (defaults) {
            m.config.model = defaults.model;
            m.config.models = { ...defaults.models };
          }
          await saveConfig(m.dir, m.config);
          // Report actual readiness, not a blanket 'ok': OpenRouter/Codex need
          // credentials, so the UI should reflect whether the switched-to
          // provider can actually run.
          const ready = await m.registry.get(cmd.provider).isReady();
          this.emit({ type: 'provider_status', provider: cmd.provider, state: ready ? 'ok' : 'error' });
          return void (await this.sendModels(m));
        }
        case 'list_models':
          return void (await this.sendModels(m));
        case 'set_model': {
          if (cmd.role === 'default') m.config.model = cmd.model;
          else m.config.models[cmd.role] = cmd.model || undefined;
          await saveConfig(m.dir, m.config);
          return this.sendModelConfig(m);
        }
        case 'set_multi_agent':
          m.config.multiAgent = cmd.enabled;
          await saveConfig(m.dir, m.config);
          return this.sendModelConfig(m);
        case 'set_secret':
          await m.secrets.set(cmd.key, cmd.value);
          return this.emit({ type: 'secrets', keys: await m.secrets.keys() });
        case 'delete_secret':
          await m.secrets.remove(cmd.key);
          return this.emit({ type: 'secrets', keys: await m.secrets.keys() });
        case 'list_secrets':
          return this.emit({ type: 'secrets', keys: await m.secrets.keys() });
        case 'get_usage':
          return void (await this.sendUsage(m));
      }
    } catch (e) {
      this.emit({ type: 'error', scope: cmd.type, message: e instanceof Error ? e.message : String(e) });
    }
  }

  /* ------------------------------- projects -------------------------------- */

  private async sendProjects(): Promise<void> {
    this.emit({ type: 'projects', projects: await this.projects.list(), active: this.mount?.dir ?? null, defaultRoot: this.projects.defaultRoot });
  }

  private async openProject(dir: string): Promise<void> {
    await this.unmount();
    const project = await this.projects.open(dir);
    const m = await this.createMount(project.path);
    this.mount = m;
    this.emit({ type: 'ready', workspaceDir: m.dir, provider: m.config.provider });
    this.emit({ type: 'tree', nodes: await m.workspace.tree() });
    this.emit({ type: 'secrets', keys: await m.secrets.keys() });
    this.sendModelConfig(m);
    await this.sendWorkflows(m);
    await this.sendProjects();
  }

  private async createMount(dir: string): Promise<Mount> {
    const workspace = new Workspace(dir);
    const memory = new Memory(dir);
    const usage = new UsageStore(dir);
    const secrets = new Secrets(dir);
    const registry = new ProviderRegistry((key) => secrets.all().then((s) => s[key]));
    const preview = new PreviewManager();
    const config = await loadConfig(dir);
    const shell = new CommandRunner(
      dir,
      () => secrets.all(),
      (data) => {
        this.emit({ type: 'term_data', data });
        const port = detectPort(data);
        if (port && preview.getPort() !== port) {
          preview.setPort(port);
          this.emit({ type: 'preview_ready', url: '/__preview/' });
        }
      },
      (code) => this.emit({ type: 'term_exit', code }),
    );
    await memory.load();
    await shell.startShell().catch(() => undefined);
    workspace.watch((path, kind) => this.emit({ type: 'file_changed', path, kind }));
    return { dir, workspace, memory, usage, secrets, registry, shell, preview, config, workflowMgr: null, workflows: [], activeWorkflow: null };
  }

  private async unmount(): Promise<void> {
    this.activeRun?.abort();
    this.activeRun = null;
    const m = this.mount;
    if (!m) return;
    m.shell.kill();
    if (m.workflowMgr) await m.workflowMgr.stop();
    await m.workspace.close();
    this.mount = null;
  }

  /* ------------------------------- workflows ------------------------------- */

  private async sendWorkflows(m: Mount): Promise<void> {
    const det = await detectWorkflows(m.dir);
    m.workflows = det.workflows;
    this.emit({ type: 'workflows', workflows: det.workflows, active: m.activeWorkflow });
  }

  private async runWorkflow(m: Mount, name?: string): Promise<void> {
    await this.stopWorkflow(m);
    const det = await detectWorkflows(m.dir);
    m.workflows = det.workflows;

    if (det.self) {
      return this.emit({ type: 'app_status', state: 'error', message: 'This is the OpenREPL folder itself — open your own app folder.' });
    }
    const wf = name ? det.workflows.find((w) => w.name === name) : det.workflows[0];
    if (!wf) {
      return this.emit({ type: 'app_status', state: 'error', message: 'No runnable app found. Ask the agent to create one (e.g. an index.html or a package.json with a dev/start script).' });
    }

    if (det.install) {
      this.emit({ type: 'app_status', state: 'installing', message: `Installing dependencies… (${det.install})` });
      const code = await m.shell.run(det.install);
      if (code !== 0) return this.emit({ type: 'app_status', state: 'error', message: 'Dependency install failed — see the terminal output.' });
    }

    this.emit({ type: 'app_status', state: 'starting', message: `Starting workflow "${wf.name}" — ${wf.steps.map((s) => s.name).join(' + ')}` });
    m.workflowMgr = new WorkflowManager(
      m.dir,
      () => m.secrets.all(),
      (step, data) => this.emit({ type: 'term_data', data: `[${step}] ${data}` }),
      (port) => {
        if (m.preview.getPort() !== port) {
          m.preview.setPort(port);
          this.emit({ type: 'preview_ready', url: '/__preview/' });
        }
        this.emit({ type: 'app_status', state: 'running', message: `"${wf.name}" running` });
      },
      (step, code) => this.emit({ type: 'app_status', state: 'stopped', message: `${step} exited (code ${code})` }),
    );
    await m.workflowMgr.start(wf);
    m.activeWorkflow = wf.name;
    this.emit({ type: 'workflows', workflows: det.workflows, active: m.activeWorkflow });
  }

  private async stopWorkflow(m: Mount): Promise<void> {
    if (m.workflowMgr) {
      await m.workflowMgr.stop();
      m.workflowMgr = null;
    }
    m.activeWorkflow = null;
    this.emit({ type: 'app_status', state: 'stopped' });
  }

  /* --------------------------------- models -------------------------------- */

  private async sendModels(m: Mount): Promise<void> {
    this.emit({ type: 'models', models: await listModels(m.config.provider) });
    this.sendModelConfig(m);
  }

  private sendModelConfig(m: Mount): void {
    this.emit({ type: 'model_config', default: m.config.model, roles: m.config.models, multiAgent: m.config.multiAgent });
  }

  private async sendUsage(m: Mount): Promise<void> {
    for (const r of await m.usage.all()) this.emit({ type: 'usage_update', record: r });
  }

  /* --------------------------------- agent --------------------------------- */

  private async runAgent(m: Mount, text: string): Promise<void> {
    const runId = randomUUID();
    await m.memory.append({ role: 'user', content: text });

    const provider = m.registry.get(m.config.provider);
    if (!(await provider.isReady())) {
      this.emit({
        type: 'error',
        scope: 'provider',
        message:
          m.config.provider === 'openrouter'
            ? 'No OPENROUTER_API_KEY set. Open the Secrets tab and add it to start using the agent.'
            : 'Codex not authenticated. Run `codex login`, or switch to OpenRouter in the Models tab.',
      });
      return this.emit({ type: 'done', runId });
    }

    const controller = new AbortController();
    this.activeRun = controller;
    this.emit({ type: 'agent_start', runId });

    const budget = new BudgetGuard(m.config.maxTokens);
    // The exact deps both engines share: writes through workspace.writeFile,
    // commands through CommandRunner, app launch through probeApp (PRD §4.3).
    const deps: ToolDeps = {
      workspace: m.workspace,
      commandAllowlist: m.config.commandAllowlist,
      // Thread the Stop signal through so a stopped turn cancels in-flight
      // installs/tests (CommandRunner) and app probes (probeApp).
      signal: controller.signal,
      runCommand: async (command) => {
        const code = await m.shell.run(command, controller.signal);
        return { code, output: m.shell.lastOutput };
      },
      runApp: () => probeApp(m.dir, () => m.secrets.all(), 12000, controller.signal),
    };

    // Claude provider → Claude Agent SDK engine (PRD §4.1). Same UiEvent stream
    // and RunResult feeding makeUsageRecord; the existing AbortController drives
    // the engine's own abort so the Stop button still kills a run (PRD §4.4).
    if (m.config.provider === 'claude') {
      try {
        const engine = new ClaudeAgentEngine();
        const result = await engine.run({
          runId,
          messages: m.memory.history(),
          config: m.config,
          deps,
          signal: controller.signal,
          emit: (e) => this.emit(e),
          apiKey: await m.registry.claudeApiKey(),
        });
        budget.add(result.tokensIn, result.tokensOut);
        // Record under the orchestrator tier (the main coding model), not the
        // generic config.model, so the dashboard's by-model accounting reflects
        // what actually ran the turn.
        const claudeModel = m.config.models?.orchestrator || m.config.model;
        await this.finishRun(m, runId, 'claude', result.text, result.tokensIn, result.tokensOut, result.costUSD, result.planUnits, claudeModel);
      } catch (e) {
        this.emit({ type: 'error', scope: 'agent', message: e instanceof Error ? e.message : String(e) });
        this.emit({ type: 'done', runId });
      } finally {
        this.activeRun = null;
      }
      return;
    }

    const tools = buildTools(deps);

    const run: AgentRun = {
      runId,
      messages: m.memory.history(),
      tools,
      model: m.config.model,
      maxSteps: m.config.maxSteps,
      signal: controller.signal,
      emit: (e) => this.emit(e),
    };

    const runWith = (p: ModelProvider) =>
      m.config.multiAgent
        ? runMultiAgent({
            provider: p,
            runId,
            messages: m.memory.history(),
            allTools: tools,
            model: m.config.model,
            roleModels: m.config.models,
            signal: controller.signal,
            emit: (e) => this.emit(e),
          })
        : runRole(p, m.config.model, run);

    try {
      const result = await runWith(provider);
      budget.add(result.tokensIn, result.tokensOut);
      await this.finishRun(m, runId, provider.id, result.text, result.tokensIn, result.tokensOut, result.costUSD, result.planUnits);
    } catch (e) {
      const status = (e as { statusCode?: number; status?: number })?.statusCode ?? (e as { status?: number })?.status;
      const fb = status && [401, 403, 429].includes(status) ? await m.registry.fallbackFrom(m.config.provider) : null;
      if (fb) {
        this.emit({ type: 'provider_status', provider: m.config.provider, state: 'fallback', message: `${status} → falling back to ${fb.id}` });
        try {
          const result = await runWith(fb);
          await this.finishRun(m, runId, fb.id, result.text, result.tokensIn, result.tokensOut, result.costUSD, result.planUnits);
          return;
        } catch (e2) {
          this.emit({ type: 'error', scope: 'agent', message: e2 instanceof Error ? e2.message : String(e2) });
        }
      } else {
        this.emit({ type: 'error', scope: 'agent', message: e instanceof Error ? e.message : String(e) });
      }
      this.emit({ type: 'done', runId });
    } finally {
      this.activeRun = null;
    }
  }

  private async finishRun(
    m: Mount,
    runId: string,
    provider: ProviderId,
    text: string,
    tokensIn: number,
    tokensOut: number,
    costUSD: number | null,
    planUnits: number | null,
    model: string = m.config.model,
  ): Promise<void> {
    if (text) await m.memory.append({ role: 'assistant', content: text });
    const record = makeUsageRecord(runId, provider, model, tokensIn, tokensOut, costUSD, planUnits, Date.now());
    await m.usage.record(record);
    this.emit({ type: 'usage_update', record });
    this.emit({ type: 'done', runId });
  }

  async close(): Promise<void> {
    await this.unmount();
  }
}
