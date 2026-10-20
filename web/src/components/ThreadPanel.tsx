import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { conversationTitle } from '../util';
import { Composer } from './Composer';
import { CloseIcon } from './Icons';
import { MessageItem } from './MessageItem';

export function ThreadPanel() {
  const { state, actions } = useStore();
  const parent = state.threadParentId !== null ? state.messages[state.threadParentId] : undefined;
  const th = parent ? state.threads[parent.id] : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const count = th?.ids.length ?? 0;

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, parent?.id]);

  useEffect(() => {
    if (state.highlightId === null) return;
    ref.current?.querySelector(`[data-msg-id="${state.highlightId}"]`)?.scrollIntoView({ block: 'center' });
  }, [state.highlightId, count]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) void actions.openThread(null);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [actions]);

  if (!parent) return null;
  const conv = state.conversations[parent.conversationId];
  const title = conv ? conversationTitle(conv, state.me!.id, state.users) : '';

  return (
    <aside className="panel thread-panel" aria-label="Thread">
      <header className="panel-head">
        <div>
          <h2>Thread</h2>
          <span className="topic">{conv?.kind === 'channel' ? `#${title}` : title}</span>
        </div>
        <button className="icon-btn" aria-label="Close thread" onClick={() => void actions.openThread(null)}>
          <CloseIcon />
        </button>
      </header>
      <div className="panel-scroll" ref={ref}>
        <div className="thread-root">
          <MessageItem message={parent} compact={false} inThread />
        </div>
        <div className="reply-divider">
          <span>{parent.replyCount === 0 ? 'No replies yet' : `${parent.replyCount} ${parent.replyCount === 1 ? 'reply' : 'replies'}`}</span>
        </div>
        {!th?.loaded ? (
          <div className="list-state">Loading replies…</div>
        ) : (
          th.ids.map((id, i) => {
            const m = state.messages[id];
            if (!m) return null;
            const prev = state.messages[th.ids[i - 1]];
            const compact = !!prev && prev.userId === m.userId && !prev.deleted && !m.deleted && m.createdAt - prev.createdAt < 5 * 60_000;
            return <MessageItem key={m.id} message={m} compact={compact} inThread />;
          })
        )}
      </div>
      {!parent.deleted ? (
        <Composer convId={parent.conversationId} parentId={parent.id} placeholder="Reply in thread" />
      ) : (
        <div className="composer-hint pad">The original message was deleted, so this thread is read-only.</div>
      )}
    </aside>
  );
}
