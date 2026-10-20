import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { CloseIcon, HashIcon } from './Icons';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button.primary')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NewChatModal({ onClose }: { onClose: () => void }) {
  const { state, actions } = useStore();
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const users = Object.values(state.users)
    .filter((u) => u.id !== state.me?.id && u.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 8 ? [...p, id] : p));
  const go = async () => {
    onClose();
    await actions.startDm(picked);
  };
  return (
    <Modal title="Start a chat" onClose={onClose}>
      <input aria-label="Search people" placeholder="Search people" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul className="pick-list">
        {users.map((u) => (
          <li key={u.id}>
            <label className="pick-row">
              <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
              <Avatar user={u} size={30} online={!!state.online[u.id]} />
              <span>{u.name}</span>
            </label>
          </li>
        ))}
        {users.length === 0 && <li className="empty-list">No one found</li>}
      </ul>
      <p className="hint">{picked.length > 1 ? 'This will open a group conversation.' : 'Pick one person for a direct message, or several for a group.'}</p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={picked.length === 0} onClick={() => void go()}>
          Open chat
        </button>
      </div>
    </Modal>
  );
}

export function BrowseSpacesModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const { state, actions } = useStore();
  return (
    <Modal title="Browse spaces" onClose={onClose}>
      <ul className="pick-list">
        {state.channels.map((c) => (
          <li key={c.id} className="space-row">
            <span className="space-glyph" aria-hidden="true">
              <HashIcon size={18} />
            </span>
            <span className="space-info">
              <strong>{c.name}</strong>
              <span className="muted">
                {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
                {c.topic ? ` · ${c.topic}` : ''}
              </span>
            </span>
            {c.joined ? (
              <span className="row-actions">
                <button
                  className="btn small"
                  onClick={() => {
                    onClose();
                    void actions.openConversation(c.id);
                  }}
                >
                  Open
                </button>
                <button className="btn small" onClick={() => void actions.leaveChannel(c.id)}>
                  Leave
                </button>
              </span>
            ) : (
              <button
                className="btn small primary"
                onClick={() => {
                  onClose();
                  void actions.joinChannel(c.id);
                }}
              >
                Join
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
        <button className="btn primary" onClick={onCreate}>
          Create a space
        </button>
      </div>
    </Modal>
  );
}

export function NewSpaceModal({ onClose }: { onClose: () => void }) {
  const { actions } = useStore();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const valid = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await actions.createChannel(name, topic);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create space');
    }
  };
  return (
    <Modal title="Create a space" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="stack">
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))} maxLength={40} placeholder="e.g. design-crit" />
        </label>
        <label>
          Topic <span className="muted">(optional)</span>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} placeholder="What is this space about?" />
        </label>
        <p className="hint">Letters, numbers, dashes and underscores. Spaces are public: anyone can browse and join.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            Create space
          </button>
        </div>
      </form>
    </Modal>
  );
}
