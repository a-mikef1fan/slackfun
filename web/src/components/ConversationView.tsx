import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Conversation } from '../types';
import { conversationTitle, formatDay, otherMembers, sameDay } from '../util';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { ArrowDownIcon, BackIcon, HashIcon, UsersIcon } from './Icons';
import { MessageItem } from './MessageItem';

function MembersPopover({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const { state } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div className="popover" ref={ref} role="dialog" aria-label="Members">
      <div className="popover-title">{conv.memberIds.length} members</div>
      <ul>
        {conv.memberIds.map((id) => (
          <li key={id}>
            <Avatar user={state.users[id]} size={28} online={!!state.online[id]} />
            <span>{state.users[id]?.name ?? 'Someone'}</span>
            {id === state.me?.id && <span className="muted">(you)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageList({ conv }: { conv: Conversation }) {
  const { state, actions } = useStore();
  const tl = state.timelines[conv.id];
  const ids = tl?.ids ?? [];
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const snapshot = useRef<number | null>(null);
  const prev = useRef<{ conv: number; first?: number; last?: number } | null>(null);
  const first = ids[0];
  const last = ids[ids.length - 1];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const p = prev.current;
    if (!p || p.conv !== conv.id || (p.first !== first && p.last !== last)) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    } else if (p.first !== first && snapshot.current !== null) {
      el.scrollTop += el.scrollHeight - snapshot.current;
    } else if (p.last !== last) {
      const mine = state.messages[last!]?.userId === state.me?.id;
      if (stick.current || mine) el.scrollTop = el.scrollHeight;
    }
    snapshot.current = null;
    prev.current = { conv: conv.id, first, last };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id, first, last, ids.length]);

  // Scroll to a jumped-to message.
  useEffect(() => {
    if (state.highlightId === null) return;
    const el = ref.current?.querySelector(`[data-msg-id="${state.highlightId}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
  }, [state.highlightId, ids.length, conv.id]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 100 && tl?.hasMore && !tl.loading) {
      snapshot.current = el.scrollHeight;
      void actions.loadOlder(conv.id);
    }
  };

  if (!tl?.loaded) return <div className="list-state">{tl?.loading || !tl ? 'Loading messages…' : ''}</div>;

  const items: JSX.Element[] = [];
  let prevMsg: (typeof state.messages)[number] | undefined;
  for (const id of ids) {
    const m = state.messages[id];
    if (!m) continue;
    if (!prevMsg || !sameDay(prevMsg.createdAt, m.createdAt)) {
      items.push(
        <div className="day-divider" key={`d${m.id}`} role="separator">
          <span>{formatDay(m.createdAt)}</span>
        </div>
      );
      prevMsg = undefined;
    }
    const compact = !!prevMsg && prevMsg.userId === m.userId && !prevMsg.deleted && !m.deleted && m.createdAt - prevMsg.createdAt < 5 * 60_000;
    items.push(<MessageItem key={m.id} message={m} compact={compact} inThread={false} />);
    prevMsg = m;
  }

  return (
    <div className="messages" ref={ref} onScroll={onScroll} role="log" aria-live="polite" aria-label="Messages">
      {tl.hasMore ? (
        <div className="list-state">{tl.loading ? 'Loading earlier messages…' : <button className="btn small" onClick={() => void actions.loadOlder(conv.id)}>Load earlier messages</button>}</div>
      ) : (
        <div className="beginning">
          <h3>{conv.kind === 'channel' ? `Welcome to #${conv.name}` : 'This is the start of your conversation'}</h3>
          <p>{conv.kind === 'channel' ? conv.topic || 'This is the very beginning of the space.' : 'Messages here are only visible to the people in this chat.'}</p>
        </div>
      )}
      {items}
      {tl.hasNewer && (
        <div className="jump-latest">
          <button className="btn primary small" onClick={() => void actions.jumpToLatest(conv.id)}>
            <ArrowDownIcon size={16} /> Jump to latest messages
          </button>
        </div>
      )}
    </div>
  );
}

export function ConversationView() {
  const { state, actions } = useStore();
  const [members, setMembers] = useState(false);
  const conv = state.activeId !== null ? state.conversations[state.activeId] : undefined;
  useEffect(() => setMembers(false), [state.activeId]);

  if (!conv) {
    return (
      <div className="main-empty">
        <h2>Pick a conversation</h2>
        <p>Choose a space or a chat from the list, or start a new one.</p>
      </div>
    );
  }
  const me = state.me!;
  const title = conversationTitle(conv, me.id, state.users);
  const others = otherMembers(conv, me.id);

  return (
    <section className="conversation" aria-label={title}>
      <header className="conv-header">
        <button className="icon-btn back-btn" aria-label="Back to conversations" onClick={() => actions.backToList()}>
          <BackIcon />
        </button>
        {conv.kind === 'channel' ? (
          <span className="space-glyph" aria-hidden="true">
            <HashIcon size={18} />
          </span>
        ) : (
          <Avatar user={state.users[others[0]]} size={32} online={others.length === 1 ? !!state.online[others[0]] : undefined} />
        )}
        <div className="conv-header-text">
          <h2>{title}</h2>
          {conv.kind === 'channel' ? (
            <span className="topic">{conv.topic || 'No topic set'}</span>
          ) : (
            <span className="topic">
              {others.length === 1 ? (state.online[others[0]] ? 'Active now' : 'Away') : `${conv.memberIds.length} people`}
            </span>
          )}
        </div>
        <div className="conv-header-actions">
          <div className="popover-anchor">
            <button className="btn small" onClick={() => setMembers((v) => !v)} aria-expanded={members}>
              <UsersIcon size={16} /> {conv.memberIds.length}
            </button>
            {members && <MembersPopover conv={conv} onClose={() => setMembers(false)} />}
          </div>
          {conv.kind === 'channel' && (
            <button
              className="btn small leave-btn"
              onClick={() => {
                if (window.confirm(`Leave #${conv.name}?`)) void actions.leaveChannel(conv.id);
              }}
            >
              Leave
            </button>
          )}
        </div>
      </header>
      <MessageList conv={conv} />
      <Composer convId={conv.id} placeholder={conv.kind === 'channel' ? `Message #${conv.name}` : `Message ${title}`} />
    </section>
  );
}
