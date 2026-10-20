import { useStore } from '../store';
import type { RailTab } from '../types';
import { ChatIcon, HomeIcon, SpacesIcon } from './Icons';
import { Logo } from './Logo';

export function Rail() {
  const { state, actions } = useStore();
  const convs = Object.values(state.conversations);
  const sum = (f: (c: (typeof convs)[number]) => boolean) => convs.filter(f).reduce((n, c) => n + c.unread, 0);
  const items: { id: RailTab; label: string; icon: JSX.Element; badge: number }[] = [
    { id: 'home', label: 'Home', icon: <HomeIcon size={22} />, badge: sum(() => true) },
    { id: 'dms', label: 'DMs', icon: <ChatIcon size={22} />, badge: sum((c) => c.kind === 'dm') },
    { id: 'spaces', label: 'Spaces', icon: <SpacesIcon size={22} />, badge: sum((c) => c.kind === 'channel') },
  ];
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-logo">
        <Logo size={38} />
      </div>
      {items.map((it) => (
        <button
          key={it.id}
          className={`rail-item ${state.rail === it.id ? 'active' : ''}`}
          aria-current={state.rail === it.id ? 'page' : undefined}
          onClick={() => {
            actions.setRail(it.id);
            actions.toast(null);
          }}
        >
          <span className="rail-icon">
            {it.icon}
            {it.badge > 0 && <span className="rail-badge">{it.badge > 99 ? '99+' : it.badge}</span>}
          </span>
          <span className="rail-label">{it.label}</span>
        </button>
      ))}
    </nav>
  );
}
