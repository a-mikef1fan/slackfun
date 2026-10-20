import { useStore } from '../store';
import { conversationTitle, formatFull, shortTime, splitHighlights } from '../util';
import { Avatar } from './Avatar';
import { CloseIcon, HashIcon } from './Icons';

export function SearchPanel() {
  const { state, actions } = useStore();
  const { search } = state;
  const me = state.me!;

  return (
    <aside className="panel search-panel" aria-label="Search results">
      <header className="panel-head">
        <div>
          <h2>Search</h2>
          <span className="topic">{search.query.trim() ? `Results for “${search.query.trim()}”` : 'Search messages you can access'}</span>
        </div>
        <button className="icon-btn" aria-label="Close search" onClick={() => actions.setSearch({ open: false })}>
          <CloseIcon />
        </button>
      </header>
      <div className="panel-scroll">
        <div className="search-tips">
          <span>Filters:</span>
          <button className="chip" onClick={() => actions.setSearch({ query: `${search.query.trimEnd()} in:`.trimStart() })}>
            in:channel
          </button>
          <button className="chip" onClick={() => actions.setSearch({ query: `${search.query.trimEnd()} from:`.trimStart() })}>
            from:name
          </button>
        </div>
        {search.loading && <div className="list-state">Searching…</div>}
        {search.error && <div className="list-state error">{search.error}</div>}
        {!search.loading && !search.error && search.results === null && (
          <div className="list-state">Type to search. Try <code>deploy in:engineering</code> or <code>from:maya</code>.</div>
        )}
        {!search.loading && search.results?.length === 0 && <div className="list-state">No messages found.</div>}
        <ul className="results">
          {search.results?.map((r) => {
            const m = r.message;
            const author = state.users[m.userId];
            const label = conversationTitle({ kind: r.conversation.kind, name: r.conversation.name, memberIds: r.conversation.memberIds }, me.id, state.users);
            return (
              <li key={m.id}>
                <button className="result" onClick={() => void actions.jumpTo(m.conversationId, m.id, m.parentId)}>
                  <Avatar user={author} size={32} />
                  <span className="result-main">
                    <span className="result-meta">
                      <strong>{author?.name ?? 'Unknown'}</strong>
                      <span className="result-where">
                        {r.conversation.kind === 'channel' ? <HashIcon size={13} /> : null}
                        {label}
                        {m.parentId !== null && ' · in thread'}
                      </span>
                      <time className="muted" title={formatFull(m.createdAt)}>
                        {shortTime(m.createdAt)}
                      </time>
                    </span>
                    <span className="result-snippet">
                      {splitHighlights(r.snippet).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
