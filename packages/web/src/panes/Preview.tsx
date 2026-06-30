import { useEffect, useState } from 'react';
import { store, useStore } from '../store.js';

const STATUS_LABEL: Record<string, string> = {
  idle: '',
  installing: 'Installing dependencies…',
  starting: 'Starting…',
  running: 'Running',
  stopped: 'Stopped',
  error: 'Error',
};

export function Preview() {
  const previewUrl = useStore((s) => s.previewUrl);
  const appStatus = useStore((s) => s.appStatus);
  const workflows = useStore((s) => s.workflows);
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (!selected && workflows.length) setSelected(workflows[0].name);
  }, [workflows, selected]);

  const busy = appStatus.state === 'installing' || appStatus.state === 'starting';
  const running = appStatus.state === 'running';
  const current = workflows.find((w) => w.name === selected);

  const run = () => store.send({ type: 'run_workflow', name: selected || undefined });

  return (
    <div className="preview">
      <div className="preview-bar">
        {workflows.length > 1 && (
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy || running}>
            {workflows.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        {!running ? (
          <button disabled={busy} onClick={run}>
            {busy ? '…' : '▶ Run'}
          </button>
        ) : (
          <button className="stop" onClick={() => store.send({ type: 'stop_app' })}>
            ■ Stop
          </button>
        )}
        <button onClick={() => setNonce((n) => n + 1)} disabled={!previewUrl}>
          Reload
        </button>
        {current && <span className="muted">steps: {current.steps.map((s) => s.name).join(' + ')}</span>}
        <span className={`app-status ${appStatus.state}`}>
          {STATUS_LABEL[appStatus.state]}
          {appStatus.message ? ` — ${appStatus.message}` : ''}
        </span>
      </div>

      {previewUrl ? (
        <iframe key={nonce} title="preview" src={previewUrl} />
      ) : (
        <div className="empty preview-empty">
          {busy ? (
            <>Setting up your app… watch the Terminal for progress.</>
          ) : appStatus.state === 'error' ? (
            <>{appStatus.message}</>
          ) : workflows.length === 0 ? (
            <>
              No runnable app detected yet.
              <br />
              <span className="muted">Ask the agent to build one, then click ▶ Run.</span>
            </>
          ) : (
            <>
              Click <strong>▶ Run</strong> to launch {workflows.length > 1 ? 'the selected workflow' : `"${workflows[0]?.name}"`} and see it here.
              <br />
              <span className="muted">OpenREPL starts every part (backend + frontend) together — no terminal needed.</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
