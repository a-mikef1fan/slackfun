import type { Conversation, User } from './types';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = [...parts[0]][0] ?? '?';
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] : '';
  return (first + last).toUpperCase();
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function formatDay(ms: number): string {
  const now = Date.now();
  if (sameDay(ms, now)) return 'Today';
  if (sameDay(ms, now - 86_400_000)) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function formatFull(ms: number): string {
  return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function shortTime(ms: number): string {
  const now = Date.now();
  if (sameDay(ms, now)) return formatTime(ms);
  if (sameDay(ms, now - 86_400_000)) return 'Yesterday';
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function otherMembers(conv: Pick<Conversation, 'memberIds'>, meId: string): string[] {
  return conv.memberIds.filter((id) => id !== meId);
}

export function conversationTitle(conv: Pick<Conversation, 'kind' | 'name' | 'memberIds'>, meId: string, users: Record<string, User>): string {
  if (conv.kind === 'channel') return conv.name ?? 'channel';
  const others = otherMembers(conv, meId).map((id) => users[id]?.name ?? 'Someone');
  return others.length ? others.join(', ') : 'Just you';
}

/** Split text into plain strings and http(s) URLs. Rendering stays in React, so everything is escaped. */
export function splitLinks(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let raw = m[0];
    const trail = raw.match(/[.,;:!?)\]]+$/);
    if (trail) raw = raw.slice(0, -trail[0].length);
    let valid = false;
    try {
      const u = new URL(raw);
      valid = u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      valid = false;
    }
    if (!valid) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: raw, url: raw });
    last = m.index + raw.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Split an FTS snippet with \u0001...\u0002 highlight markers into parts. */
export function splitHighlights(snippet: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let hit = false;
  let buf = '';
  for (const ch of snippet) {
    if (ch === '\u0001' || ch === '\u0002') {
      if (buf) out.push({ text: buf, hit });
      buf = '';
      hit = ch === '\u0001';
    } else buf += ch;
  }
  if (buf) out.push({ text: buf, hit });
  return out;
}

export const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '🚀', '👀', '🙏', '✅', '🔥', '💡', '😮', '😢', '👏', '🙌', '💯', '👎'];
