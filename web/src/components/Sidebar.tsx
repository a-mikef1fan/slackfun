import { useState } from 'react';
import { useStore } from '../store';
import type { Conversation } from '../types';
import { conversationTitle, otherMembers, shortTime } from '../util';
import { Avatar } from './Avatar';
import { BrowseSpacesModal, NewChatModal, NewSpaceModal } from './Modals';
import { HashIcon, PlusIcon } from './Icons';

function ConversationRow({ conv }: { conv: Conversation }) {
  const { state, actions } = useStore();
  const me = state.me!;
  const title = conversationTitle(conv, me.id, state.users);
  const others = otherMembers(conv, me.id);
  const active = state.activeId === conv.id;
  const last = conv.lastMessage;
  const authorName = last ? (last.userId === me.id ? 'You' : state.users[last.userId]?.name.split(' ')[0] ?? 'Someone') : '';
  return (
    <li>
      <button
        className={`conv-row ${active ? 'active' : ''} ${conv.unread > 0 ? 'unread' : ''}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => void actions.openConversation(conv.id)}
      >
        {conv.kind === 'channel' ? (
          <span className="space-glyph" aria-hidden="true">
            <HashIcon size={18} />
          </span>
        ) : (
          <span className="dm-avatar">
            <Avatar user={state.users[others[0]]} size={34} online={others.length === 1 ? !!state.online[others[0]] : undefined} />
            {others.length > 1 && <span className="dm-count">{others.length + 1}</span>}
          </span>
        )}
        <span className="conv-main">
          <span className="conv-top">
            <span className="conv-title">{title}</span>
            {last && <span className="conv-time">{shortTime(last.createdAt)}</span>}
          </span>
          <span className="conv-bottom">
            <span className="conv-preview">{last ? `${authorName}: ${last.body}` : conv.kind === 'channel' ? conv.topic || 'No messages yet' : 'Say hello'}</span>
            {conv.unread > 0 && (
              <span className="badge" aria-label={`${conv.unread} unread`}>
                {conv.unread > 99 ? '99+' : conv.unread}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

export function Sidebar() {
  const { state, actions } = useStore();
  const [modal, setModal] = useState<null | 'browse' | 'new-space' | 'new-chat'>(null);
  const all = Object.values(state.conversations).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const list =
    state.rail === 'dms' ? all.filter((c) => c.kind === 'dm') : state.rail === 'spaces' ? all.filter((c) => c.kind === 'channel') : all;
  const title = state.rail === 'home' ? 'Home' : state.rail === 'dms' ? 'Direct messages' : 'Spaces';

  return (
    <aside className={`sidebar ${state.mobileList ? 'mobile-visible' : ''}`} aria-label={title}>
      <div className="sidebar-head">
        <h2>{title}</h2>
        {state.rail === 'dms' && (
          <button className="btn small primary" onClick={() => setModal('new-chat')}>
            <PlusIcon size={16} /> New chat
          </button>
        )}
        {state.rail === 'spaces' && (
          <button
            className="btn small primary"
            onClick={() => {
              void actions.refreshChannels();
              setModal('browse');
            }}
          >
            <PlusIcon size={16} /> Browse
          </button>
        )}
        {state.rail === 'home' && (
          <button className="btn small" onClick={() => setModal('new-chat')}>
            <PlusIcon size={16} /> New chat
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <div className="empty-list">
          {state.rail === 'dms' ? 'No direct messages yet. Start a chat with a teammate.' : state.rail === 'spaces' ? 'You have not joined any spaces yet.' : 'Nothing here yet.'}
        </div>
      ) : (
        <ul className="conv-list">
          {list.map((c) => (
            <ConversationRow key={c.id} conv={c} />
          ))}
        </ul>
      )}
      {modal === 'new-chat' && <NewChatModal onClose={() => setModal(null)} />}
      {modal === 'browse' && (
        <BrowseSpacesModal
          onClose={() => setModal(null)}
          onCreate={() => setModal('new-space')}
        />
      )}
      {modal === 'new-space' && <NewSpaceModal onClose={() => setModal(null)} />}
    </aside>
  );
}
