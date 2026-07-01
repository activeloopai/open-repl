import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { store, useStore } from '../store.js';
import type { FileTreeNode } from '@openrepl/shared';

function langFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'py':
      return [python()];
    case 'html':
      return [html()];
    case 'json':
      return [json()];
    default:
      return [];
  }
}

export function FilesEditor() {
  const tree = useStore((s) => s.tree);
  const openPath = useStore((s) => s.openPath);
  const openContent = useStore((s) => s.openContent);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Sync external content into the editor when not actively editing.
  useEffect(() => {
    if (!editing) setDraft(openContent);
  }, [openContent, editing]);

  const onChange = (value: string) => {
    setDraft(value);
    setEditing(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (openPath) store.send({ type: 'save_file', path: openPath, content: value });
      setEditing(false);
    }, 400);
  };

  return (
    <div className="filesEditor">
      <aside className="tree">
        <TreeView nodes={tree} />
      </aside>
      <div className="editor">
        {openPath ? (
          <>
            <div className="filepath">{openPath}</div>
            <CodeMirror value={draft} theme="dark" height="100%" extensions={langFor(openPath)} onChange={onChange} />
          </>
        ) : (
          <div className="empty">Select a file from the tree.</div>
        )}
      </div>
    </div>
  );
}

function TreeView({ nodes, depth = 0 }: { nodes: FileTreeNode[]; depth?: number }) {
  return (
    <ul className="treelist">
      {nodes.map((n) => (
        <TreeNode key={n.path} node={n} depth={depth} />
      ))}
    </ul>
  );
}

function TreeNode({ node, depth }: { node: FileTreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const openPath = useStore((s) => s.openPath);
  if (node.type === 'dir') {
    return (
      <li>
        <div className="node dir" style={{ paddingLeft: depth * 12 }} onClick={() => setOpen(!open)}>
          <span className="tw">{open ? '▾' : '▸'}</span> {node.name}
        </div>
        {open && node.children && <TreeView nodes={node.children} depth={depth + 1} />}
      </li>
    );
  }
  return (
    <li>
      <div
        className={`node file ${openPath === node.path ? 'sel' : ''}`}
        style={{ paddingLeft: depth * 12 + 14 }}
        onClick={() => store.send({ type: 'open_file', path: node.path })}
      >
        {node.name}
      </div>
    </li>
  );
}
