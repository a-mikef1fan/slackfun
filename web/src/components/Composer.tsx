import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import { SendIcon } from './Icons';
import { TypingIndicator } from './Typing';

const drafts = new Map<string, string>();

export function Composer({ convId, parentId = null, placeholder }: { convId: number; parentId?: number | null; placeholder: string }) {
  const { actions } = useStore();
  const key = `${convId}:${parentId ?? 0}`;
  const [text, setText] = useState(() => drafts.get(key) ?? '');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(drafts.get(key) ?? '');
  }, [key]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const update = (v: string) => {
    setText(v);
    drafts.set(key, v);
    if (v.trim()) actions.sendTyping(convId, parentId);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await actions.send(convId, body, parentId ?? undefined);
      drafts.delete(key);
      setText('');
    } catch {
      /* toast shown by the store; keep the draft */
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="composer-wrap">
      <TypingIndicator convId={convId} parentId={parentId} />
      <div className="composer">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => update(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="send-btn" aria-label="Send message" disabled={!text.trim() || sending} onClick={() => void submit()}>
          <SendIcon size={20} />
        </button>
      </div>
      <div className="composer-hint">Enter to send, Shift+Enter for a new line</div>
    </div>
  );
}
