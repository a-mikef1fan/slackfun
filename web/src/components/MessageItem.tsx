import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import type { Message } from '../types';
import { QUICK_EMOJI, formatFull, formatTime, splitLinks, timeAgo } from '../util';
import { Avatar } from './Avatar';
import { PencilIcon, ReplyIcon, SmileIcon, TrashIcon } from './Icons';

function Body({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.url ? (
          <a key={i} href={part.url} target="_blank" rel="noopener noreferrer nofollow">
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

function EmojiPicker({ onPick, onClose }: { onPick: (e: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div className="emoji-pop" ref={ref} role="menu" aria-label="Pick a reaction">
      {QUICK_EMOJI.map((e) => (
        <button key={e} role="menuitem" className="emoji-btn" onClick={() => onPick(e)} aria-label={`React with ${e}`}>
          {e}
        </button>
      ))}
    </div>
  );
}

export function MessageItem({ message, compact, inThread }: { message: Message; compact: boolean; inThread: boolean }) {
  const { state, actions } = useStore();
  const me = state.me!;
  const author = state.users[message.userId];
  const mine = message.userId === me.id;
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const highlighted = state.highlightId === message.id;

  const nameOf = (id: string) => (id === me.id ? 'You' : state.users[id]?.name ?? 'Someone');

  const saveEdit = async () => {
    const body = draft.trim();
    if (!body) return;
    if (body === message.body) return setEditing(false);
    try {
      await actions.edit(message.id, body);
      setEditing(false);
    } catch {
      /* toast shown */
    }
  };
  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    } else if (e.key === 'Escape') setEditing(false);
  };

  if (message.deleted) {
    return (
      <div className={`msg deleted ${compact ? 'compact' : ''}`} data-msg-id={message.id}>
        <div className="msg-gutter" />
        <div className="msg-body">
          <em>This message was deleted.</em>
          {!inThread && message.replyCount > 0 && (
            <button className="thread-link" onClick={() => void actions.openThread(message.id)}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`msg ${compact ? 'compact' : ''} ${highlighted ? 'highlight' : ''}`} data-msg-id={message.id} tabIndex={0}>
      <div className="msg-gutter">
        {compact ? <span className="msg-time-hover">{formatTime(message.createdAt)}</span> : <Avatar user={author} size={36} />}
      </div>
      <div className="msg-main">
        {!compact && (
          <div className="msg-head">
            <span className="msg-author">{author?.name ?? 'Unknown'}</span>
            <time className="msg-time" title={formatFull(message.createdAt)} dateTime={new Date(message.createdAt).toISOString()}>
              {formatTime(message.createdAt)}
            </time>
          </div>
        )}
        {editing ? (
          <div className="edit-box">
            <textarea autoFocus value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} onKeyDown={onEditKey} aria-label="Edit message" />
            <div className="edit-actions">
              <span className="hint">Esc to cancel, Enter to save</span>
              <button className="btn small" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn small primary" onClick={() => void saveEdit()} disabled={!draft.trim()}>
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="msg-body">
            <Body text={message.body} />
            {message.editedAt && <span className="edited"> (edited)</span>}
          </div>
        )}

        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((r) => {
              const iReacted = r.userIds.includes(me.id);
              const who = r.userIds.map(nameOf).join(', ');
              return (
                <button
                  key={r.emoji}
                  className={`chip ${iReacted ? 'mine' : ''}`}
                  title={`${who} reacted with ${r.emoji}`}
                  aria-label={`${r.emoji} ${r.count}, ${who}. ${iReacted ? 'Remove' : 'Add'} your reaction`}
                  aria-pressed={iReacted}
                  onClick={() => void actions.react(message.id, r.emoji)}
                >
                  <span>{r.emoji}</span>
                  <span className="chip-count">{r.count}</span>
                </button>
              );
            })}
            <span className="add-react-wrap">
              <button className="chip add" aria-label="Add reaction" onClick={() => setPicker((p) => !p)}>
                <SmileIcon size={16} />
              </button>
            </span>
          </div>
        )}

        {!inThread && message.replyCount > 0 && (
          <button className="thread-link" onClick={() => void actions.openThread(message.id)}>
            <Avatar user={message.lastReplyUserId ? state.users[message.lastReplyUserId] : undefined} size={20} />
            <strong>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </strong>
            {message.lastReplyAt && <span className="muted">Last reply {timeAgo(message.lastReplyAt)}</span>}
          </button>
        )}
        {picker && (
          <div className="picker-anchor">
            <EmojiPicker
              onClose={() => setPicker(false)}
              onPick={(e) => {
                setPicker(false);
                void actions.react(message.id, e);
              }}
            />
          </div>
        )}
      </div>

      {!editing && (
        <div className="msg-actions" role="toolbar" aria-label="Message actions">
          <button className="icon-btn" title="Add reaction" aria-label="Add reaction" onClick={() => setPicker((p) => !p)}>
            <SmileIcon size={18} />
          </button>
          {!inThread && (
            <button className="icon-btn" title="Reply in thread" aria-label="Reply in thread" onClick={() => void actions.openThread(message.id)}>
              <ReplyIcon size={18} />
            </button>
          )}
          {mine && (
            <button
              className="icon-btn"
              title="Edit"
              aria-label="Edit message"
              onClick={() => {
                setDraft(message.body);
                setEditing(true);
              }}
            >
              <PencilIcon size={18} />
            </button>
          )}
          {mine && (
            <button
              className="icon-btn danger"
              title="Delete"
              aria-label="Delete message"
              onClick={() => {
                if (window.confirm('Delete this message? This cannot be undone.')) void actions.remove(message.id);
              }}
            >
              <TrashIcon size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
