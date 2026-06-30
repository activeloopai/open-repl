import { useState, useRef, useEffect } from 'react';
import { store, useStore, type ChatMessage } from '../store.js';

export function Chat() {
  const messages = useStore((s) => s.messages);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    store.sendMessage(t);
    setText('');
  };

  return (
    <div className="chat">
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            Ask the agent to build something. Try: <code>create a file hello.js</code>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView key={i} m={m} />
        ))}
        <div ref={endRef} />
      </div>
      <div className="composer">
        <textarea
          value={text}
          placeholder="Message the agent…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button onClick={submit}>Send</button>
      </div>
    </div>
  );
}

function MessageView({ m }: { m: ChatMessage }) {
  return (
    <div className={`msg ${m.role}`}>
      <div className="role">{m.role}</div>
      {m.tools.map((t) => {
        const delegate = t.name.startsWith('delegate_to_');
        const role = delegate ? t.name.replace('delegate_to_', '') : null;
        return (
          <div key={t.id} className={`tool ${delegate ? 'delegate' : ''}`}>
            <span className="toolname">{delegate ? `→ ${role}` : `⚙ ${t.name}`}</span>
            <code className="toolargs">{summarize(t.args)}</code>
            {t.result !== undefined && <span className="toolok">✓</span>}
          </div>
        );
      })}
      <div className="content">{m.content || (m.streaming ? '…' : '')}</div>
    </div>
  );
}

function summarize(args: unknown): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  } catch {
    return '';
  }
}
