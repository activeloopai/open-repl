import { useState } from 'react';
import { store, useStore } from '../store.js';

export function Secrets() {
  const secrets = useStore((s) => s.secrets);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const add = () => {
    if (!key.trim()) return;
    store.send({ type: 'set_secret', key: key.trim(), value });
    setKey('');
    setValue('');
  };

  return (
    <div className="secrets">
      <p className="muted">
        Stored in <code>.env</code> in your workspace (chmod 600). Injected into commands, terminal and preview.
      </p>
      <div className="secret-add">
        <input placeholder="KEY" value={key} onChange={(e) => setKey(e.target.value)} />
        <input placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
        <button onClick={add}>Add</button>
      </div>
      <ul className="secret-list">
        {secrets.length === 0 && <li className="muted">No secrets yet. Add OPENROUTER_API_KEY to use a real model.</li>}
        {secrets.map((k) => (
          <li key={k}>
            <code>{k}</code>
            <span className="masked">••••••••</span>
            <button onClick={() => store.send({ type: 'delete_secret', key: k })}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
