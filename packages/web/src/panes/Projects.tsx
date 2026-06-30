import { useState } from 'react';
import { store, useStore } from '../store.js';

export function ProjectsSidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const projects = useStore((s) => s.projects);
  const activeProject = useStore((s) => s.activeProject);
  const defaultRoot = useStore((s) => s.projectsDefaultRoot);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');

  const create = () => {
    if (!name.trim()) return;
    store.send({ type: 'create_project', name: name.trim(), path: path.trim() || undefined });
    setName('');
    setPath('');
    setCreating(false);
  };

  if (!open) {
    return (
      <div className="projects-rail collapsed" onClick={onToggle} title="Projects">
        <span className="rail-icon">▸</span>
        <span className="rail-label">Projects</span>
      </div>
    );
  }

  return (
    <aside className="projects-rail">
      <div className="projects-head">
        <strong>Projects</strong>
        <button className="ghost" onClick={onToggle} title="Collapse">
          ◂
        </button>
      </div>

      <ul className="projects-list">
        {projects.length === 0 && <li className="muted small">No projects yet. Create one →</li>}
        {projects.map((p) => (
          <li
            key={p.path}
            className={`project ${p.path === activeProject ? 'active' : ''}`}
            title={p.path}
            onClick={() => store.send({ type: 'open_project', path: p.path })}
          >
            <div className="project-name">{p.name}</div>
            <div className="project-path muted small">{p.path}</div>
          </li>
        ))}
      </ul>

      {creating ? (
        <div className="project-create">
          <input autoFocus placeholder="project name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <input placeholder={`folder (default: ${defaultRoot || '~/openrepl-projects'}/…)`} value={path} onChange={(e) => setPath(e.target.value)} />
          <div className="row">
            <button onClick={create}>Create</button>
            <button className="ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="new-project" onClick={() => setCreating(true)}>
          ＋ New project
        </button>
      )}
    </aside>
  );
}
