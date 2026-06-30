import { useSyncExternalStore } from 'react';
import type { UiEvent, ClientCommand, FileTreeNode, ProviderId, UsageRecord, ModelInfo, AgentRole, Workflow, Project } from '@openrepl/shared';

export interface ModelConfig {
  default: string;
  roles: Partial<Record<AgentRole, string>>;
  multiAgent: boolean;
}

export interface ToolEvent {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  runId?: string;
  tools: ToolEvent[];
  streaming?: boolean;
}

export interface AppState {
  connected: boolean;
  workspaceDir: string;
  provider: ProviderId;
  tree: FileTreeNode[];
  openPath: string | null;
  openContent: string;
  messages: ChatMessage[];
  running: boolean;
  previewUrl: string | null;
  secrets: string[];
  usage: UsageRecord[];
  models: ModelInfo[];
  modelConfig: ModelConfig;
  appStatus: { state: 'idle' | 'installing' | 'starting' | 'running' | 'stopped' | 'error'; message?: string };
  workflows: Workflow[];
  activeWorkflow: string | null;
  projects: Project[];
  activeProject: string | null;
  projectsDefaultRoot: string;
  notice: string | null;
}

const initial: AppState = {
  connected: false,
  workspaceDir: '',
  provider: 'openrouter',
  tree: [],
  openPath: null,
  openContent: '',
  messages: [],
  running: false,
  previewUrl: null,
  secrets: [],
  usage: [],
  models: [],
  modelConfig: { default: '', roles: {}, multiAgent: true },
  appStatus: { state: 'idle' },
  workflows: [],
  activeWorkflow: null,
  projects: [],
  activeProject: null,
  projectsDefaultRoot: '',
  notice: null,
};

type Listener = () => void;
type TermListener = (data: string) => void;

class Store {
  private state: AppState = initial;
  private listeners = new Set<Listener>();
  private termListeners = new Set<TermListener>();
  private ws: WebSocket | null = null;

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => this.set({ connected: true });
    ws.onclose = () => {
      this.set({ connected: false });
      setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (ev) => {
      try {
        this.apply(JSON.parse(ev.data) as UiEvent);
      } catch {
        /* ignore malformed */
      }
    };
  }

  send(cmd: ClientCommand): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd));
  }

  onTerm(fn: TermListener): () => void {
    this.termListeners.add(fn);
    return () => this.termListeners.delete(fn);
  }

  getSnapshot = (): AppState => this.state;
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private lastAssistant(runId: string): ChatMessage {
    const msgs = this.state.messages;
    let msg = [...msgs].reverse().find((m) => m.role === 'assistant' && m.runId === runId);
    if (!msg) {
      msg = { role: 'assistant', content: '', runId, tools: [], streaming: true };
      this.set({ messages: [...msgs, msg] });
    }
    return msg;
  }

  private updateMessages(fn: (m: ChatMessage[]) => ChatMessage[]): void {
    this.set({ messages: fn(this.state.messages) });
  }

  private apply(e: UiEvent): void {
    switch (e.type) {
      case 'ready':
        return this.set({
          workspaceDir: e.workspaceDir,
          provider: e.provider,
          messages: [],
          openPath: null,
          openContent: '',
          previewUrl: null,
          usage: [],
          appStatus: { state: 'idle' },
        });
      case 'tree':
        return this.set({ tree: e.nodes });
      case 'file_changed': {
        this.send({ type: 'list_tree' });
        if (e.path === this.state.openPath && e.kind !== 'unlink') this.send({ type: 'open_file', path: e.path });
        return;
      }
      case 'file_content':
        return this.set({ openPath: e.path, openContent: e.content });
      case 'agent_start':
        return this.updateMessages((m) => [...m, { role: 'assistant', content: '', runId: e.runId, tools: [], streaming: true }]);
      case 'agent_token':
        this.lastAssistant(e.runId);
        return this.updateMessages((m) =>
          m.map((msg) => (msg.runId === e.runId && msg.role === 'assistant' ? { ...msg, content: msg.content + e.text } : msg)),
        );
      case 'agent_tool_call':
        this.lastAssistant(e.runId);
        return this.updateMessages((m) =>
          m.map((msg) =>
            msg.runId === e.runId && msg.role === 'assistant'
              ? { ...msg, tools: [...msg.tools, { id: e.id, name: e.name, args: e.args }] }
              : msg,
          ),
        );
      case 'agent_tool_result':
        return this.updateMessages((m) =>
          m.map((msg) =>
            msg.runId === e.runId && msg.role === 'assistant'
              ? { ...msg, tools: msg.tools.map((t) => (t.id === e.id ? { ...t, result: e.result } : t)) }
              : msg,
          ),
        );
      case 'term_data':
        return this.termListeners.forEach((l) => l(e.data));
      case 'preview_ready':
        return this.set({ previewUrl: e.url });
      case 'app_status':
        return this.set({ appStatus: { state: e.state, message: e.message } });
      case 'workflows':
        return this.set({ workflows: e.workflows, activeWorkflow: e.active });
      case 'projects':
        return this.set({ projects: e.projects, activeProject: e.active, projectsDefaultRoot: e.defaultRoot });
      case 'provider_status':
        return this.set({ notice: e.state === 'fallback' ? `Fallback: ${e.message ?? ''}` : null });
      case 'usage_update':
        return this.set({ usage: [...this.state.usage.filter((u) => u.runId !== e.record.runId), e.record] });
      case 'secrets':
        return this.set({ secrets: e.keys });
      case 'models':
        return this.set({ models: e.models });
      case 'model_config':
        return this.set({ modelConfig: { default: e.default, roles: e.roles, multiAgent: e.multiAgent } });
      case 'error':
        return this.set({ notice: `Error (${e.scope}): ${e.message}` });
      case 'done':
        return this.updateMessages((m) => m.map((msg) => (msg.runId === e.runId ? { ...msg, streaming: false } : msg)));
    }
  }

  // user actions
  sendMessage(text: string): void {
    this.updateMessages((m) => [...m, { role: 'user', content: text, tools: [] }]);
    this.send({ type: 'send_message', text });
  }
}

export const store = new Store();

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()));
}
