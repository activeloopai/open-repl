import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { store } from '../store.js';

export function Terminal() {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const [cmd, setCmd] = useState('');

  useEffect(() => {
    if (!ref.current || termRef.current) return;
    const term = new XTerm({
      convertEol: true,
      fontSize: 13,
      theme: { background: '#0d1117', foreground: '#c9d1d9' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    const sendFit = () => {
      try {
        fit.fit();
        store.send({ type: 'term_resize', cols: term.cols, rows: term.rows });
      } catch {
        /* not visible yet */
      }
    };
    sendFit();
    termRef.current = term;

    term.onData((data) => store.send({ type: 'term_input', data }));
    const unsub = store.onTerm((data) => term.write(data));
    const onResize = () => sendFit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      unsub();
    };
  }, []);

  return (
    <div className="terminal">
      <div className="xterm-host" ref={ref} />
      <div className="cmdbar">
        <input
          value={cmd}
          placeholder="run a command (e.g. npm run dev)…"
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && cmd.trim()) {
              store.send({ type: 'run_command', command: cmd });
              setCmd('');
            }
          }}
        />
      </div>
    </div>
  );
}
