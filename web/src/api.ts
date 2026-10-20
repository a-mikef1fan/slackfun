import type { ChannelListing, Conversation, Message, Reaction, SearchResult, User } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(t: string | null) {
  token = t;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    if (res.status === 401 && token && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`);
  }
  return json as T;
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  hasNewer: boolean;
}

export const api = {
  demoUsers: () => request<{ users: User[] }>('GET', '/api/demo-users'),
  login: (name: string) => request<{ user: User; token: string }>('POST', '/api/users', { name }),
  me: () => request<{ user: User }>('GET', '/api/me'),
  users: () => request<{ users: (User & { online: boolean })[] }>('GET', '/api/users'),
  conversations: () => request<{ conversations: Conversation[] }>('GET', '/api/conversations'),
  conversation: (id: number) => request<{ conversation: Conversation }>('GET', `/api/conversations/${id}`),
  channels: () => request<{ channels: ChannelListing[] }>('GET', '/api/channels'),
  createChannel: (name: string, topic: string) =>
    request<{ channel: ChannelListing; conversation: Conversation }>('POST', '/api/channels', { name, topic }),
  joinChannel: (id: number) => request<{ conversation: Conversation }>('POST', `/api/channels/${id}/join`, {}),
  leaveChannel: (id: number) => request<{ left: boolean }>('POST', `/api/channels/${id}/leave`, {}),
  openDm: (userIds: string[]) => request<{ conversation: Conversation }>('POST', '/api/dms', { userIds }),
  messages: (id: number, q: { before?: number; around?: number; limit?: number } = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v));
    return request<MessagePage>('GET', `/api/conversations/${id}/messages?${p}`);
  },
  send: (id: number, body: string, parentId?: number) =>
    request<{ message: Message }>('POST', `/api/conversations/${id}/messages`, { body, parentId }),
  edit: (id: number, body: string) => request<{ message: Message }>('PATCH', `/api/messages/${id}`, { body }),
  remove: (id: number) => request<{ message: Message }>('DELETE', `/api/messages/${id}`),
  thread: (id: number) => request<{ parent: Message; replies: Message[] }>('GET', `/api/messages/${id}/thread`),
  react: (id: number, emoji: string) =>
    request<{ added: boolean; reactions: Reaction[] }>('POST', `/api/messages/${id}/reactions`, { emoji }),
  markRead: (id: number) => request<{ lastReadId: number }>('POST', `/api/conversations/${id}/read`, {}),
  search: (q: string) => request<{ results: SearchResult[]; terms: string[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
};
