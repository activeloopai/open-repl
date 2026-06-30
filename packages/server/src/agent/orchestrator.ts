import type { ModelProvider, AgentRun, AgentTool, RunResult } from '../providers/types.js';
import type { Message, UiEvent } from '@openrepl/shared';
import { SUBAGENTS, ORCHESTRATOR_SYSTEM, type SubAgentDef } from './subagents.js';
import { runRole } from './runtime.js';

export interface MultiAgentArgs {
  provider: ModelProvider;
  runId: string;
  messages: Message[];
  allTools: AgentTool[];
  /** Default model. */
  model: string;
  /** Per-role model overrides (orchestrator / planner / coder / reviewer). */
  roleModels?: Partial<Record<string, string>>;
  signal: AbortSignal;
  emit: (e: UiEvent) => void;
  /** caps to keep a confused team from running away */
  orchestratorMaxSteps?: number;
  subAgentMaxSteps?: number;
}

/**
 * Multi-agent orchestration (agents-as-tools / handoff).
 *
 * The Orchestrator runs a normal tool-calling loop, but its tools are the
 * sub-agents. Calling delegate_to_<role> spins up that sub-agent with its own
 * system prompt and a restricted tool set; the sub-agent's tool activity is
 * forwarded to the UI (so file writes show up live), and its final text becomes
 * the delegation's result that the Orchestrator reads. Tokens/cost are summed
 * across the Orchestrator and every sub-agent for the usage dashboard.
 */
export async function runMultiAgent(args: MultiAgentArgs): Promise<RunResult> {
  const totals = { tokensIn: 0, tokensOut: 0, costUSD: null as number | null, planUnits: null as number | null };
  const add = (r: RunResult) => {
    totals.tokensIn += r.tokensIn;
    totals.tokensOut += r.tokensOut;
    if (r.costUSD != null) totals.costUSD = (totals.costUSD ?? 0) + r.costUSD;
    if (r.planUnits != null) totals.planUnits = (totals.planUnits ?? 0) + r.planUnits;
  };
  const modelFor = (role: string) => args.roleModels?.[role] || args.model;

  const makeDelegateTool = (def: SubAgentDef): AgentTool => ({
    name: `delegate_to_${def.name}`,
    description: `Delegate one concrete, self-contained task to the ${def.name}. ${def.description}`,
    parameters: {
      type: 'object',
      properties: { task: { type: 'string', description: 'A concrete, self-contained task for the sub-agent.' } },
      required: ['task'],
    },
    async execute(a) {
      const task = String(a.task ?? '');
      const tools = args.allTools.filter((t) => def.toolNames.includes(t.name));
      const subRun: AgentRun = {
        runId: args.runId,
        messages: [{ role: 'user', content: task }],
        tools,
        model: modelFor(def.name),
        maxSteps: args.subAgentMaxSteps ?? 18, // room for the run → fix → run loop
        signal: args.signal,
        systemPrompt: def.systemPrompt,
        // Forward the sub-agent's tool activity to the UI (files appear live),
        // but swallow its narration tokens — the Orchestrator does the talking.
        emit: (e) => {
          if (e.type === 'agent_tool_call' || e.type === 'agent_tool_result') args.emit(e);
        },
      };
      const r = await runRole(args.provider, modelFor(def.name), subRun);
      add(r);
      return { agent: def.name, output: r.text };
    },
  });

  const orchestratorRun: AgentRun = {
    runId: args.runId,
    messages: args.messages,
    tools: SUBAGENTS.map(makeDelegateTool),
    model: modelFor('orchestrator'),
    maxSteps: args.orchestratorMaxSteps ?? 8,
    signal: args.signal,
    systemPrompt: ORCHESTRATOR_SYSTEM,
    emit: args.emit,
  };

  const orchestrator = await runRole(args.provider, modelFor('orchestrator'), orchestratorRun);
  add(orchestrator);
  return { ...totals, text: orchestrator.text };
}
