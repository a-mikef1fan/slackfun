import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, setToken, setUnauthorizedHandler } from './api';
import { ReconnectingSocket, type ConnStatus } from './socket';
import type { ChannelListing, Conversation, Message, RailTab, Reaction, SearchResult, ServerEvent, User } from './types';

export interface Timeline {
  ids: number[];
  hasMore: boolean;
  hasNewer: boolean;
  loaded: boolean;
  loading: boolean;
}

export interface State {
  me: User | null;
  users: Record<string, User>;
  online: Record<string, true>;
  conversations: Record<number, Conversation>;
  channels: ChannelListing[];
  messages: Record<number, Message>;
  timelines: Record<number, Timeline>;
  threads: Record<number, { ids: number[]; loaded: boolean }>;
  typing: Record<string, Record<string, number>>; // key conv:parent -> userId -> expiry ms
  activeId: number | null;
  threadParentId: number | null;
  rail: RailTab;
  search: { open: boolean; query: string; loading: boolean; error: string | null; results: SearchResult[] | null };
  highlightId: number | null;
  conn: ConnStatus;
  mobileList: boolean;
  toast: string | null;
}

const emptyTimeline: Timeline = { ids: [], hasMore: false, hasNewer: false, loaded: false, loading: false };

const initial: State = {
  me: null,
  users: {},
  online: {},
  conversations: {},
  channels: [],
  messages: {},
  timelines: {},
  threads: {},
  typing: {},
  activeId: null,
  threadParentId: null,
  rail: 'home',
  search: { open: false, query: '', loading: false, error: null, results: null },
  highlightId: null,
  conn: 'connecting',
  mobileList: true,
  toast: null,
};

type Action =
  | { t: 'me'; me: User | null }
  | { t: 'users'; users: User[] }
  | { t: 'convs'; conversations: Conversation[] }
  | { t: 'conv'; conversation: Conversation }
  | { t: 'convRemove'; id: number }
  | { t: 'online'; ids: string[] }
  | { t: 'presence'; userId: string; online: boolean }
  | { t: 'channels'; channels: ChannelListing[] }
  | { t: 'channelUpsert'; channel: ChannelListing }
  | { t: 'tlLoading'; convId: number }
  | { t: 'tl'; convId: number; messages: Message[]; hasMore: boolean; hasNewer: boolean; mode: 'replace' | 'prepend' | 'merge' }
  | { t: 'msgNew'; message: Message }
  | { t: 'msgUpsert'; message: Message }
  | { t: 'thread'; parent: Message; replies: Message[] }
  | { t: 'threadUpdated'; parentId: number; replyCount: number; lastReplyAt: number | null; lastReplyUserId: string | null }
  | { t: 'reactions'; messageId: number; reactions: Reaction[] }
  | { t: 'typing'; convId: number; parentId: number | null; userId: string; until: number }
  | { t: 'open'; id: number | null; keepThread?: boolean }
  | { t: 'openThread'; parentId: number | null }
  | { t: 'rail'; rail: RailTab }
  | { t: 'search'; patch: Partial<State['search']> }
  | { t: 'highlight'; id: number | null }
  | { t: 'conn'; status: ConnStatus }
  | { t: 'mobileList'; show: boolean }
  | { t: 'toast'; text: string | null };

const byId = (a: number, b: number) => a - b;
const union = (a: number[], b: number[]) => [...new Set([...a, ...b])].sort(byId);

function isViewing(state: State, convId: number): boolean {
  return state.activeId === convId && typeof document !== 'undefined' && document.visibilityState === 'visible';
}

function reducer(state: State, a: Action): State {
  switch (a.t) {
    case 'me':
      return a.me ? { ...state, me: a.me, users: { ...state.users, [a.me.id]: a.me } } : { ...initial };
    case 'users': {
      const users = { ...state.users };
      for (const u of a.users) users[u.id] = u;
      return { ...state, users };
    }
    case 'convs': {
      const conversations: Record<number, Conversation> = {};
      for (const c of a.conversations) conversations[c.id] = c;
      return { ...state, conversations };
    }
    case 'conv':
      return { ...state, conversations: { ...state.conversations, [a.conversation.id]: a.conversation } };
    case 'convRemove': {
      const conversations = { ...state.conversations };
      delete conversations[a.id];
      const gone = state.activeId === a.id;
      return {
        ...state,
        conversations,
        activeId: gone ? null : state.activeId,
        threadParentId: gone ? null : state.threadParentId,
        mobileList: gone ? true : state.mobileList,
      };
    }
    case 'online': {
      const online: Record<string, true> = {};
      for (const id of a.ids) online[id] = true;
      return { ...state, online };
    }
    case 'presence': {
      const online = { ...state.online };
      if (a.online) online[a.userId] = true;
      else delete online[a.userId];
      return { ...state, online };
    }
    case 'channels':
      return { ...state, channels: a.channels };
    case 'channelUpsert': {
      const exists = state.channels.some((c) => c.id === a.channel.id);
      const channels = exists ? state.channels.map((c) => (c.id === a.channel.id ? a.channel : c)) : [...state.channels, a.channel];
      return { ...state, channels: channels.sort((x, y) => x.name.localeCompare(y.name)) };
    }
    case 'tlLoading':
      return {
        ...state,
        timelines: { ...state.timelines, [a.convId]: { ...(state.timelines[a.convId] ?? emptyTimeline), loading: true } },
      };
    case 'tl': {
      const prev = state.timelines[a.convId] ?? emptyTimeline;
      const messages = { ...state.messages };
      for (const m of a.messages) messages[m.id] = m;
      const newIds = a.messages.map((m) => m.id);
      let tl: Timeline;
      if (a.mode === 'replace') tl = { ids: newIds, hasMore: a.hasMore, hasNewer: a.hasNewer, loaded: true, loading: false };
      else if (a.mode === 'prepend') tl = { ...prev, ids: union(newIds, prev.ids), hasMore: a.hasMore, loading: false };
      else tl = { ...prev, ids: union(prev.ids, newIds), hasNewer: a.hasNewer, loaded: true, loading: false };
      return { ...state, messages, timelines: { ...state.timelines, [a.convId]: tl } };
    }
    case 'msgNew': {
      const m = a.message;
      const messages = { ...state.messages, [m.id]: m };
      let timelines = state.timelines;
      let threads = state.threads;
      if (m.parentId === null) {
        const tl = timelines[m.conversationId];
        if (tl?.loaded && !tl.hasNewer && !tl.ids.includes(m.id)) {
          timelines = { ...timelines, [m.conversationId]: { ...tl, ids: [...tl.ids, m.id] } };
        }
      } else {
        const th = threads[m.parentId];
        if (th?.loaded && !th.ids.includes(m.id)) threads = { ...threads, [m.parentId]: { ...th, ids: [...th.ids, m.id] } };
      }
      const conv = state.conversations[m.conversationId];
      let conversations = state.conversations;
      if (conv) {
        const fromOther = m.userId !== state.me?.id;
        const bump = fromOther && m.parentId === null && !isViewing(state, m.conversationId);
        conversations = {
          ...conversations,
          [conv.id]: {
            ...conv,
            lastMessage: { id: m.id, userId: m.userId, body: m.body.slice(0, 140), createdAt: m.createdAt },
            lastActivityAt: m.createdAt,
            unread: conv.unread + (bump ? 1 : 0),
          },
        };
      }
      return { ...state, messages, timelines, threads, conversations };
    }
    case 'msgUpsert':
      return { ...state, messages: { ...state.messages, [a.message.id]: a.message } };
    case 'thread': {
      const messages = { ...state.messages, [a.parent.id]: a.parent };
      for (const r of a.replies) messages[r.id] = r;
      return { ...state, messages, threads: { ...state.threads, [a.parent.id]: { ids: a.replies.map((r) => r.id), loaded: true } } };
    }
    case 'threadUpdated': {
      const p = state.messages[a.parentId];
      if (!p) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [p.id]: { ...p, replyCount: a.replyCount, lastReplyAt: a.lastReplyAt, lastReplyUserId: a.lastReplyUserId },
        },
      };
    }
    case 'reactions': {
      const m = state.messages[a.messageId];
      if (!m) return state;
      return { ...state, messages: { ...state.messages, [m.id]: { ...m, reactions: a.reactions } } };
    }
    case 'typing': {
      const key = `${a.convId}:${a.parentId ?? 0}`;
      return { ...state, typing: { ...state.typing, [key]: { ...(state.typing[key] ?? {}), [a.userId]: a.until } } };
    }
    case 'open':
      return {
        ...state,
        activeId: a.id,
        threadParentId: a.keepThread ? state.threadParentId : null,
        search: a.keepThread ? state.search : { ...state.search, open: false },
        mobileList: a.id === null,
      };
    case 'openThread':
      return { ...state, threadParentId: a.parentId, search: a.parentId ? { ...state.search, open: false } : state.search };
    case 'rail':
      return { ...state, rail: a.rail };
    case 'search': {
      const search = { ...state.search, ...a.patch };
      return { ...state, search, threadParentId: search.open ? null : state.threadParentId };
    }
    case 'highlight':
      return { ...state, highlightId: a.id };
    case 'conn':
      return { ...state, conn: a.status };
    case 'mobileList':
      return { ...state, mobileList: a.show };
    case 'toast':
      return { ...state, toast: a.text };
  }
}

export interface Actions {
  login(name: string): Promise<void>;
  logout(): void;
  openConversation(id: number, opts?: { around?: number; keepThread?: boolean }): Promise<void>;
  loadOlder(convId: number): Promise<void>;
  jumpToLatest(convId: number): Promise<void>;
  openThread(parentId: number | null): Promise<void>;
  jumpTo(conv: number, messageId: number, parentId: number | null): Promise<void>;
  send(convId: number, body: string, parentId?: number): Promise<void>;
  edit(id: number, body: string): Promise<void>;
  remove(id: number): Promise<void>;
  react(id: number, emoji: string): Promise<void>;
  startDm(userIds: string[]): Promise<void>;
  createChannel(name: string, topic: string): Promise<void>;
  joinChannel(id: number): Promise<void>;
  leaveChannel(id: number): Promise<void>;
  refreshChannels(): Promise<void>;
  runSearch(q: string): Promise<void>;
  sendTyping(convId: number, parentId: number | null): void;
  markRead(convId: number): Promise<void>;
  setRail(r: RailTab): void;
  setSearch(patch: Partial<State['search']>): void;
  backToList(): void;
  toast(text: string | null): void;
}

const Ctx = createContext<{ state: State; actions: Actions } | null>(null);

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}

const STORAGE_KEY = 'huddle.session';

function loadSession(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveSession(s: { id: string; name: string } | null) {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [booting, setBooting] = useState(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  const socketRef = useRef<ReconnectingSocket | null>(null);
  const lastTypingSent = useRef(0);
  const readInFlight = useRef<Set<number>>(new Set());

  const actions = useMemo<Actions>(() => {
    const fail = (e: unknown) => {
      const msg = e instanceof ApiError ? e.message : 'Something went wrong. Check your connection.';
      dispatch({ t: 'toast', text: msg });
    };

    const loadLatest = async (convId: number, merge: boolean) => {
      dispatch({ t: 'tlLoading', convId });
      const page = await api.messages(convId, { limit: 50 });
      const tl = stateRef.current.timelines[convId];
      const lastLocal = tl?.ids.length ? tl.ids[tl.ids.length - 1] : 0;
      // If the fetched page doesn't reach back to what we already hold, there's a gap: replace instead of merge.
      const gap = page.hasMore && page.messages.length > 0 && page.messages[0].id > lastLocal;
      dispatch({
        t: 'tl',
        convId,
        messages: page.messages,
        hasMore: merge && tl?.loaded && !gap ? tl.hasMore : page.hasMore,
        hasNewer: false,
        mode: merge && tl?.loaded && !gap && !tl.hasNewer ? 'merge' : 'replace',
      });
    };

    const a: Actions = {
      async login(name) {
        const { user, token } = await api.login(name);
        saveSession({ id: user.id, name: user.name });
        setToken(token);
        dispatch({ t: 'me', me: user });
      },
      logout() {
        socketRef.current?.close();
        socketRef.current = null;
        saveSession(null);
        setToken(null);
        dispatch({ t: 'me', me: null });
      },
      async openConversation(id, opts = {}) {
        dispatch({ t: 'open', id, keepThread: opts.keepThread });
        try {
          const tl = stateRef.current.timelines[id];
          if (opts.around) {
            dispatch({ t: 'tlLoading', convId: id });
            const page = await api.messages(id, { around: opts.around, limit: 50 });
            dispatch({ t: 'tl', convId: id, messages: page.messages, hasMore: page.hasMore, hasNewer: page.hasNewer, mode: 'replace' });
          } else if (!tl?.loaded || tl.hasNewer) {
            await loadLatest(id, false);
          }
        } catch (e) {
          fail(e);
        }
      },
      async loadOlder(convId) {
        const tl = stateRef.current.timelines[convId];
        if (!tl || tl.loading || !tl.hasMore || tl.ids.length === 0) return;
        dispatch({ t: 'tlLoading', convId });
        try {
          const page = await api.messages(convId, { before: tl.ids[0], limit: 50 });
          dispatch({ t: 'tl', convId, messages: page.messages, hasMore: page.hasMore, hasNewer: false, mode: 'prepend' });
        } catch (e) {
          fail(e);
          dispatch({ t: 'tl', convId, messages: [], hasMore: true, hasNewer: false, mode: 'prepend' });
        }
      },
      async jumpToLatest(convId) {
        try {
          await loadLatest(convId, false);
        } catch (e) {
          fail(e);
        }
      },
      async openThread(parentId) {
        dispatch({ t: 'openThread', parentId });
        if (parentId === null) return;
        try {
          const { parent, replies } = await api.thread(parentId);
          dispatch({ t: 'thread', parent, replies });
        } catch (e) {
          fail(e);
        }
      },
      async jumpTo(conv, messageId, parentId) {
        const root = parentId ?? messageId;
        const s = stateRef.current;
        const tl = s.timelines[conv];
        const rail = s.conversations[conv]?.kind === 'dm' ? 'dms' : 'spaces';
        dispatch({ t: 'rail', rail });
        if (s.activeId === conv && tl?.ids.includes(root)) dispatch({ t: 'open', id: conv, keepThread: true });
        else await a.openConversation(conv, { around: root, keepThread: true });
        if (parentId) await a.openThread(parentId);
        else dispatch({ t: 'openThread', parentId: null });
        dispatch({ t: 'highlight', id: messageId });
      },
      async send(convId, body, parentId) {
        try {
          const { message } = await api.send(convId, body, parentId);
          // The WebSocket echo normally delivers this first; dispatching is idempotent.
          dispatch({ t: 'msgNew', message });
        } catch (e) {
          fail(e);
          throw e;
        }
      },
      async edit(id, body) {
        try {
          const { message } = await api.edit(id, body);
          dispatch({ t: 'msgUpsert', message });
        } catch (e) {
          fail(e);
          throw e;
        }
      },
      async remove(id) {
        try {
          const { message } = await api.remove(id);
          dispatch({ t: 'msgUpsert', message });
        } catch (e) {
          fail(e);
        }
      },
      async react(id, emoji) {
        try {
          const r = await api.react(id, emoji);
          dispatch({ t: 'reactions', messageId: id, reactions: r.reactions });
        } catch (e) {
          fail(e);
        }
      },
      async startDm(userIds) {
        try {
          const { conversation } = await api.openDm(userIds);
          dispatch({ t: 'conv', conversation });
          dispatch({ t: 'rail', rail: 'dms' });
          await a.openConversation(conversation.id);
        } catch (e) {
          fail(e);
        }
      },
      async createChannel(name, topic) {
        try {
          const { channel, conversation } = await api.createChannel(name, topic);
          dispatch({ t: 'channelUpsert', channel });
          dispatch({ t: 'conv', conversation });
          dispatch({ t: 'rail', rail: 'spaces' });
          await a.openConversation(conversation.id);
        } catch (e) {
          fail(e);
          throw e;
        }
      },
      async joinChannel(id) {
        try {
          const { conversation } = await api.joinChannel(id);
          dispatch({ t: 'conv', conversation });
          await a.refreshChannels();
          dispatch({ t: 'rail', rail: 'spaces' });
          await a.openConversation(id);
        } catch (e) {
          fail(e);
        }
      },
      async leaveChannel(id) {
        try {
          await api.leaveChannel(id);
          dispatch({ t: 'convRemove', id });
          await a.refreshChannels();
        } catch (e) {
          fail(e);
        }
      },
      async refreshChannels() {
        try {
          dispatch({ t: 'channels', channels: (await api.channels()).channels });
        } catch (e) {
          fail(e);
        }
      },
      async runSearch(q) {
        const query = q.trim();
        if (!query) {
          dispatch({ t: 'search', patch: { results: null, loading: false, error: null } });
          return;
        }
        dispatch({ t: 'search', patch: { loading: true, error: null } });
        try {
          const r = await api.search(query);
          if (stateRef.current.search.query.trim() === query) {
            dispatch({ t: 'search', patch: { results: r.results, loading: false } });
          }
        } catch (e) {
          dispatch({
            t: 'search',
            patch: { loading: false, results: null, error: e instanceof ApiError && e.status === 400 ? 'Try a word, or in:channel / from:name' : 'Search failed' },
          });
        }
      },
      sendTyping(convId, parentId) {
        const now = Date.now();
        if (now - lastTypingSent.current < 2500) return;
        lastTypingSent.current = now;
        socketRef.current?.send({ type: 'typing', conversationId: convId, parentId });
      },
      async markRead(convId) {
        const conv = stateRef.current.conversations[convId];
        if (!conv || conv.unread === 0 || readInFlight.current.has(convId)) return;
        readInFlight.current.add(convId);
        dispatch({ t: 'conv', conversation: { ...conv, unread: 0 } });
        try {
          await api.markRead(convId);
        } catch {
          /* next event will resync */
        } finally {
          readInFlight.current.delete(convId);
        }
      },
      setRail(rail) {
        dispatch({ t: 'rail', rail });
        dispatch({ t: 'mobileList', show: true });
      },
      setSearch(patch) {
        dispatch({ t: 'search', patch });
      },
      backToList() {
        dispatch({ t: 'mobileList', show: true });
      },
      toast(text) {
        dispatch({ t: 'toast', text });
      },
    };
    return a;
  }, []);

  // ---- boot: restore session
  useEffect(() => {
    setUnauthorizedHandler(() => actions.logout());
    const s = loadSession();
    if (!s) {
      setBooting(false);
      return;
    }
    setToken(s.id);
    api
      .me()
      .then(({ user }) => dispatch({ t: 'me', me: user }))
      .catch(() => {
        saveSession(null);
        setToken(null);
      })
      .finally(() => setBooting(false));
  }, [actions, setBooting]);

  // ---- after login: initial data + realtime
  const meId = state.me?.id;
  useEffect(() => {
    if (!meId) return;
    let cancelled = false;
    const loadAll = async () => {
      const [u, c] = await Promise.all([api.users(), api.conversations()]);
      if (cancelled) return;
      dispatch({ t: 'users', users: u.users });
      dispatch({ t: 'online', ids: u.users.filter((x) => x.online).map((x) => x.id) });
      dispatch({ t: 'convs', conversations: c.conversations });
      return c.conversations;
    };
    loadAll()
      .then((convs) => {
        if (cancelled || !convs || stateRef.current.activeId !== null) return;
        const first = [...convs].filter((c) => c.kind === 'channel').sort((a, b) => a.id - b.id)[0] ?? convs[0];
        if (first && window.matchMedia('(min-width: 781px)').matches) void actions.openConversation(first.id);
      })
      .catch(() => dispatch({ t: 'toast', text: 'Could not load your conversations' }));

    const ensureUser = (id: string) => {
      if (!stateRef.current.users[id]) api.users().then((r) => dispatch({ t: 'users', users: r.users })).catch(() => {});
    };

    const resync = async () => {
      try {
        const [u, c] = await Promise.all([api.users(), api.conversations()]);
        dispatch({ t: 'users', users: u.users });
        dispatch({ t: 'convs', conversations: c.conversations });
        const s = stateRef.current;
        if (s.activeId !== null && c.conversations.some((x) => x.id === s.activeId)) {
          const tl = s.timelines[s.activeId];
          if (tl?.loaded && !tl.hasNewer) {
            const page = await api.messages(s.activeId, { limit: 50 });
            const lastLocal = tl.ids.length ? tl.ids[tl.ids.length - 1] : 0;
            const gap = page.hasMore && page.messages.length > 0 && page.messages[0].id > lastLocal;
            dispatch({
              t: 'tl',
              convId: s.activeId,
              messages: page.messages,
              hasMore: gap ? page.hasMore : tl.hasMore,
              hasNewer: false,
              mode: gap ? 'replace' : 'merge',
            });
          }
        }
        if (s.threadParentId !== null) {
          const { parent, replies } = await api.thread(s.threadParentId);
          dispatch({ t: 'thread', parent, replies });
        }
        // refresh presence snapshot
        dispatch({ t: 'online', ids: u.users.filter((x) => x.online).map((x) => x.id) });
      } catch {
        /* the next reconnect will try again */
      }
    };

    const onEvent = (e: ServerEvent) => {
      switch (e.type) {
        case 'hello':
          dispatch({ t: 'online', ids: e.online });
          break;
        case 'presence':
          dispatch({ t: 'presence', userId: e.userId, online: e.online });
          ensureUser(e.userId);
          break;
        case 'message.new':
          ensureUser(e.message.userId);
          dispatch({ t: 'msgNew', message: e.message });
          break;
        case 'message.updated':
          dispatch({ t: 'msgUpsert', message: e.message });
          break;
        case 'message.deleted':
          dispatch({ t: 'msgUpsert', message: e.message });
          api.conversation(e.message.conversationId).then((r) => dispatch({ t: 'conv', conversation: r.conversation })).catch(() => {});
          break;
        case 'thread.updated':
          dispatch({ t: 'threadUpdated', parentId: e.parentId, replyCount: e.replyCount, lastReplyAt: e.lastReplyAt, lastReplyUserId: e.lastReplyUserId });
          break;
        case 'reaction.updated':
          dispatch({ t: 'reactions', messageId: e.messageId, reactions: e.reactions });
          break;
        case 'typing':
          ensureUser(e.userId);
          dispatch({ t: 'typing', convId: e.conversationId, parentId: e.parentId, userId: e.userId, until: Date.now() + 4000 });
          break;
        case 'conversation.new':
          dispatch({ t: 'conv', conversation: e.conversation });
          break;
        case 'channel.created':
          dispatch({ t: 'channelUpsert', channel: e.channel });
          break;
        case 'member.joined':
          ensureUser(e.userId);
          api.conversation(e.conversationId).then((r) => dispatch({ t: 'conv', conversation: r.conversation })).catch(() => {});
          break;
        case 'member.left':
          if (e.userId === stateRef.current.me?.id) dispatch({ t: 'convRemove', id: e.conversationId });
          else api.conversation(e.conversationId).then((r) => dispatch({ t: 'conv', conversation: r.conversation })).catch(() => {});
          break;
        case 'read':
          api.conversation(e.conversationId).then((r) => dispatch({ t: 'conv', conversation: r.conversation })).catch(() => {});
          break;
        default:
          break;
      }
    };

    const sock = new ReconnectingSocket(meId, {
      onEvent,
      onStatus: (status) => dispatch({ t: 'conn', status }),
      onReconnect: () => void resync(),
    });
    socketRef.current = sock;
    return () => {
      cancelled = true;
      sock.close();
      if (socketRef.current === sock) socketRef.current = null;
    };
  }, [meId, actions]);

  // Mark the open conversation as read whenever it has unread messages and the tab is visible.
  const activeUnread = state.activeId !== null ? state.conversations[state.activeId]?.unread ?? 0 : 0;
  useEffect(() => {
    if (state.activeId === null || activeUnread === 0) return;
    const run = () => {
      if (document.visibilityState === 'visible') void actions.markRead(state.activeId!);
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [state.activeId, activeUnread, actions]);

  // Total unread in the tab title.
  const totalUnread = Object.values(state.conversations).reduce((n, c) => n + c.unread, 0);
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Huddle` : 'Huddle';
  }, [totalUnread]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ t: 'toast', text: null }), 4000);
    return () => clearTimeout(t);
  }, [state.toast]);

  // Clear highlight after a moment.
  useEffect(() => {
    if (state.highlightId === null) return;
    const t = setTimeout(() => dispatch({ t: 'highlight', id: null }), 2600);
    return () => clearTimeout(t);
  }, [state.highlightId]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  if (booting) return <div className="boot" aria-busy="true" />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
