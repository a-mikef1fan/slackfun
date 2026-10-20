import { useEffect, useState } from 'react';
import { useStore } from '../store';

export function TypingIndicator({ convId, parentId }: { convId: number; parentId: number | null }) {
  const { state } = useStore();
  const [, tick] = useState(0);
  const entries = state.typing[`${convId}:${parentId ?? 0}`] ?? {};
  const now = Date.now();
  const names = Object.entries(entries)
    .filter(([id, until]) => until > now && id !== state.me?.id)
    .map(([id]) => state.users[id]?.name.split(' ')[0] ?? 'Someone');
  const active = names.length > 0;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  let text = '';
  if (names.length === 1) text = `${names[0]} is typing`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing`;
  else if (names.length > 2) text = 'Several people are typing';
  return (
    <div className="typing" aria-live="polite" style={{ visibility: active ? 'visible' : 'hidden' }}>
      {active && (
        <>
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {text}
        </>
      )}
    </div>
  );
}
