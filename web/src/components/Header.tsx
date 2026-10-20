import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { CloseIcon, LogoutIcon, SearchIcon } from './Icons';

export function Header() {
  const { state, actions } = useStore();
  const { search } = state;
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);

  // Debounced search-as-you-type.
  useEffect(() => {
    if (!search.open) return;
    const t = setTimeout(() => void actions.runSearch(search.query), 250);
    return () => clearTimeout(t);
  }, [search.query, search.open, actions]);

  // "/" focuses search.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(el.tagName)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  return (
    <header className="topbar">
      <div className="brand-text">Huddle</div>
      <div className={`search-box ${search.open ? 'open' : ''}`} role="search">
        <SearchIcon size={18} />
        <input
          ref={input}
          type="search"
          aria-label="Search messages"
          placeholder="Search messages   ( / )"
          value={search.query}
          onFocus={() => actions.setSearch({ open: true })}
          onChange={(e) => actions.setSearch({ query: e.target.value, open: true })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void actions.runSearch(search.query);
            if (e.key === 'Escape') {
              actions.setSearch({ open: false });
              input.current?.blur();
            }
          }}
        />
        {search.query && (
          <button className="icon-btn" aria-label="Clear search" onClick={() => actions.setSearch({ query: '', results: null, error: null })}>
            <CloseIcon size={16} />
          </button>
        )}
      </div>
      <div className="topbar-right">
        {state.conn !== 'open' && (
          <span className="conn-pill" role="status">
            {state.conn === 'connecting' ? 'Connecting…' : 'Offline, reconnecting…'}
          </span>
        )}
        <div className="user-menu">
          <button
            className="user-btn"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={(e) => {
              e.stopPropagation();
              setMenu((v) => !v);
            }}
          >
            <Avatar user={state.me ?? undefined} size={34} online={state.conn === 'open'} />
            <span className="user-name">{state.me?.name}</span>
          </button>
          {menu && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => actions.logout()}>
                <LogoutIcon size={16} /> Switch user
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
