import type { User } from '../types';
import { initials } from '../util';

export function Avatar({ user, size = 36, online }: { user?: Pick<User, 'name' | 'color'>; size?: number; online?: boolean }) {
  const name = user?.name ?? '?';
  return (
    <span className="avatar" style={{ width: size, height: size, background: user?.color ?? '#8a959a', fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {initials(name)}
      {online !== undefined && <span className={`presence ${online ? 'on' : 'off'}`} style={{ width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28) }} />}
    </span>
  );
}
