import { useState } from 'react';
import { store, useStore } from './store.js';
import { Chat } from './panes/Chat.js';
import { FilesEditor } from './panes/FilesEditor.js';
import { Terminal } from './panes/Terminal.js';
import { Preview } from './panes/Preview.js';
import { Usage } from './panes/Usage.js';
import { Secrets } from './panes/Secrets.js';
import { Models } from './panes/Models.js';
import { ProjectsSidebar } from './panes/Projects.js';

type Tab = 'editor' | 'preview' | 'terminal' | 'models' | 'usage' | 'secrets';

const TABS: { id: Tab; label: string }[] = [
  { id: 'editor', label: 'Files' },
  { id: 'preview', label: 'Preview' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'models', label: 'Models' },
  { id: 'usage', label: 'Usage' },
  { id: 'secrets', label: 'Secrets' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('editor');
  const [projectsOpen, setProjectsOpen] = useState(true);
  const connected = useStore((s) => s.connected);
  const workspaceDir = useStore((s) => s.workspaceDir);
  const activeProject = useStore((s) => s.activeProject);
  const provider = useStore((s) => s.provider);
  const notice = useStore((s) => s.notice);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">OpenREPL</span>
        <span className="muted">{activeProject ?? 'no project'}</span>
        <span className="spacer" />
        {activeProject && <ProviderPicker provider={provider} />}
        <span className={`dot ${connected ? 'ok' : 'bad'}`} title={connected ? 'connected' : 'disconnected'} />
      </header>
      {notice && <div className="notice">{notice}</div>}
      <div className="split">
        <ProjectsSidebar open={projectsOpen} onToggle={() => setProjectsOpen((o) => !o)} />
        {activeProject ? (
          <>
            <div className="left">
              <Chat />
            </div>
            <div className="right">
              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                    {t.label}
                  </button>
                ))}
              </nav>
              <div className="tabbody">
                <div hidden={tab !== 'editor'} className="fill">
                  <FilesEditor />
                </div>
                <div hidden={tab !== 'preview'} className="fill">
                  <Preview />
                </div>
                {/* Terminal stays mounted so xterm keeps its buffer */}
                <div hidden={tab !== 'terminal'} className="fill">
                  <Terminal />
                </div>
                <div hidden={tab !== 'models'} className="fill">
                  <Models />
                </div>
                <div hidden={tab !== 'usage'} className="fill">
                  <Usage />
                </div>
                <div hidden={tab !== 'secrets'} className="fill">
                  <Secrets />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="no-project">
            <div>
              <h2>Welcome to OpenREPL</h2>
              <p className="muted">Create or select a project to start — each project is its own folder.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderPicker({ provider }: { provider: string }) {
  return (
    <select
      className="provider"
      value={provider}
      onChange={(e) => store.send({ type: 'set_provider', provider: e.target.value as never })}
    >
      <option value="openrouter">OpenRouter</option>
      <option value="codex">Codex (sub)</option>
    </select>
  );
}
