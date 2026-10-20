import { randomUUID } from 'node:crypto';
import type { Database as Db } from 'better-sqlite3';
import type { ChannelListing, ConversationSummary, Message, Reaction, User } from './types.js';
import { parseSearchQuery } from './search.js';

const COLORS = ['#e4572e', '#17a398', '#7768ae', '#e8a33d', '#2e86ab', '#c1478b', '#5b8e3f', '#d1604d'];

export function makeHandle(name: string): string {
  const h = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return h || 'user';
}

interface MessageRow {
  id: number;
  conversationId: number;
  userId: string;
  parentId: number | null;
  body: string;
  createdAt: number;
  editedAt: number | null;
  deleted: number;
  replyCount: number;
  lastReplyAt: number | null;
  lastReplyUserId: string | null;
}

const MESSAGE_SELECT = `
SELECT m.id, m.conversation_id AS conversationId, m.user_id AS userId, m.parent_id AS parentId,
  CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
  m.created_at AS createdAt, m.edited_at AS editedAt, (m.deleted_at IS NOT NULL) AS deleted,
  (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL) AS replyCount,
  (SELECT MAX(r.created_at) FROM messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL) AS lastReplyAt,
  (SELECT r.user_id FROM messages r WHERE r.parent_id = m.id AND r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 1) AS lastReplyUserId
FROM messages m
`;

export class ConflictError extends Error {}
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class BadRequestError extends Error {}

export class Store {
  constructor(public readonly db: Db) {}

  // ---------------------------------------------------------------- users

  getUser(id: string): User | undefined {
    return this.db.prepare('SELECT id, name, handle, color FROM users WHERE id = ?').get(id) as User | undefined;
  }

  listUsers(): User[] {
    return this.db.prepare('SELECT id, name, handle, color FROM users ORDER BY name COLLATE NOCASE').all() as User[];
  }

  listDemoUsers(): User[] {
    return this.db
      .prepare('SELECT id, name, handle, color FROM users WHERE is_demo = 1 ORDER BY created_at, rowid')
      .all() as User[];
  }

  /** Find a user by name (case-insensitive) or create one. New users join all default channels. */
  findOrCreateUser(name: string, opts: { demo?: boolean } = {}): { user: User; created: boolean } {
    const clean = name.trim().replace(/\s+/g, ' ');
    const existing = this.db
      .prepare('SELECT id, name, handle, color FROM users WHERE name = ? COLLATE NOCASE')
      .get(clean) as User | undefined;
    if (existing) return { user: existing, created: false };
    return this.db.transaction(() => {
      const id = randomUUID();
      let handle = makeHandle(clean);
      let n = 1;
      while (this.db.prepare('SELECT 1 FROM users WHERE handle = ?').get(handle)) handle = `${makeHandle(clean)}-${++n}`;
      const count = (this.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
      const color = COLORS[count % COLORS.length];
      this.db
        .prepare('INSERT INTO users (id, name, handle, color, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, clean, handle, color, opts.demo ? 1 : 0, Date.now());
      const defaults = this.db.prepare('SELECT id FROM conversations WHERE is_default = 1').all() as { id: number }[];
      for (const c of defaults) this.addMember(c.id, id);
      return { user: { id, name: clean, handle, color }, created: true };
    })();
  }

  // -------------------------------------------------------- conversations

  isMember(conversationId: number, userId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM members WHERE conversation_id = ? AND user_id = ?')
      .get(conversationId, userId);
  }

  memberIds(conversationId: number): string[] {
    return (
      this.db
        .prepare('SELECT user_id FROM members WHERE conversation_id = ? ORDER BY joined_at, user_id')
        .all(conversationId) as { user_id: string }[]
    ).map((r) => r.user_id);
  }

  private maxMessageId(conversationId: number): number {
    return (
      this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM messages WHERE conversation_id = ?').get(conversationId) as {
        m: number;
      }
    ).m;
  }

  addMember(conversationId: number, userId: string, lastReadId?: number): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO members (conversation_id, user_id, last_read_id, joined_at) VALUES (?, ?, ?, ?)')
      .run(conversationId, userId, lastReadId ?? this.maxMessageId(conversationId), Date.now());
    return res.changes > 0;
  }

  removeMember(conversationId: number, userId: string): boolean {
    return this.db.prepare('DELETE FROM members WHERE conversation_id = ? AND user_id = ?').run(conversationId, userId).changes > 0;
  }

  getConversation(id: number): { id: number; kind: 'channel' | 'dm'; name: string | null; topic: string } | undefined {
    return this.db.prepare('SELECT id, kind, name, topic FROM conversations WHERE id = ?').get(id) as any;
  }

  createChannel(userId: string, name: string, topic: string): number {
    try {
      return this.db.transaction(() => {
        const res = this.db
          .prepare("INSERT INTO conversations (kind, name, topic, created_by, created_at) VALUES ('channel', ?, ?, ?, ?)")
          .run(name, topic, userId, Date.now());
        const id = Number(res.lastInsertRowid);
        this.addMember(id, userId, 0);
        return id;
      })();
    } catch (e: any) {
      if (String(e?.code).startsWith('SQLITE_CONSTRAINT')) throw new ConflictError('A channel with that name already exists');
      throw e;
    }
  }

  listChannels(userId: string): ChannelListing[] {
    return (
      this.db
        .prepare(
          `SELECT c.id, c.name, c.topic, c.created_at AS createdAt,
             (SELECT COUNT(*) FROM members m WHERE m.conversation_id = c.id) AS memberCount,
             EXISTS (SELECT 1 FROM members m WHERE m.conversation_id = c.id AND m.user_id = ?) AS joined
           FROM conversations c WHERE c.kind = 'channel' ORDER BY c.name COLLATE NOCASE`
        )
        .all(userId) as any[]
    ).map((r) => ({ ...r, joined: !!r.joined }));
  }

  getChannelListing(id: number, userId: string): ChannelListing | undefined {
    return this.listChannels(userId).find((c) => c.id === id);
  }

  /** Find or create a DM (1:1 or group) for exactly this set of members. */
  findOrCreateDm(userIds: string[]): { id: number; created: boolean } {
    const set = [...new Set(userIds)].sort();
    const key = set.join(',');
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM conversations WHERE dm_key = ?').get(key) as { id: number } | undefined;
      if (existing) return { id: existing.id, created: false };
      const res = this.db
        .prepare("INSERT INTO conversations (kind, dm_key, created_by, created_at) VALUES ('dm', ?, ?, ?)")
        .run(key, set[0], Date.now());
      const id = Number(res.lastInsertRowid);
      for (const u of set) this.addMember(id, u, 0);
      return { id, created: true };
    })();
  }

  /** Conversations the user belongs to, with unread counts and last message. */
  listConversations(userId: string): ConversationSummary[] {
    const ids = (
      this.db.prepare('SELECT conversation_id AS id FROM members WHERE user_id = ?').all(userId) as { id: number }[]
    ).map((r) => r.id);
    return ids.map((id) => this.getConversationSummary(id, userId)!).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  getConversationSummary(id: number, userId: string): ConversationSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT c.id, c.kind, c.name, c.topic, c.created_at AS createdAt, mem.last_read_id AS lastReadId
         FROM conversations c JOIN members mem ON mem.conversation_id = c.id AND mem.user_id = ?
         WHERE c.id = ?`
      )
      .get(userId, id) as any;
    if (!row) return undefined;
    const unread = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS c FROM messages
           WHERE conversation_id = ? AND parent_id IS NULL AND deleted_at IS NULL AND id > ? AND user_id <> ?`
        )
        .get(id, row.lastReadId, userId) as { c: number }
    ).c;
    const last = this.db
      .prepare(
        `SELECT id, user_id AS userId, body, created_at AS createdAt FROM messages
         WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`
      )
      .get(id) as { id: number; userId: string; body: string; createdAt: number } | undefined;
    if (last) last.body = last.body.slice(0, 140);
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      topic: row.topic,
      createdAt: row.createdAt,
      memberIds: this.memberIds(id),
      unread,
      lastMessage: last ?? null,
      lastActivityAt: last?.createdAt ?? row.createdAt,
    };
  }

  markRead(conversationId: number, userId: string, messageId?: number): number {
    // Clamp so a client can never "pre-read" messages that do not exist yet.
    const max = this.maxMessageId(conversationId);
    const target = Math.min(messageId ?? max, max);
    this.db
      .prepare('UPDATE members SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?')
      .run(target, conversationId, userId);
    return (
      this.db
        .prepare('SELECT last_read_id AS l FROM members WHERE conversation_id = ? AND user_id = ?')
        .get(conversationId, userId) as { l: number }
    ).l;
  }

  // ------------------------------------------------------------- messages

  private hydrate(rows: MessageRow[]): Message[] {
    if (rows.length === 0) return [];
    const placeholders = rows.map(() => '?').join(',');
    const rx = this.db
      .prepare(
        `SELECT message_id AS messageId, emoji, user_id AS userId FROM reactions
         WHERE message_id IN (${placeholders}) ORDER BY created_at, rowid`
      )
      .all(...rows.map((r) => r.id)) as { messageId: number; emoji: string; userId: string }[];
    const byMsg = new Map<number, Map<string, string[]>>();
    for (const r of rx) {
      let m = byMsg.get(r.messageId);
      if (!m) byMsg.set(r.messageId, (m = new Map()));
      const arr = m.get(r.emoji);
      if (arr) arr.push(r.userId);
      else m.set(r.emoji, [r.userId]);
    }
    return rows.map((r) => ({
      ...r,
      deleted: !!r.deleted,
      reactions: [...(byMsg.get(r.id) ?? new Map<string, string[]>())].map(([emoji, userIds]) => ({
        emoji,
        count: userIds.length,
        userIds,
      })),
    }));
  }

  getMessage(id: number): Message | undefined {
    const row = this.db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(id) as MessageRow | undefined;
    return row ? this.hydrate([row])[0] : undefined;
  }

  /** Raw lookup used for permission checks (works on deleted messages too). */
  getMessageMeta(id: number): { id: number; conversationId: number; userId: string; parentId: number | null; deleted: boolean } | undefined {
    const r = this.db
      .prepare('SELECT id, conversation_id AS conversationId, user_id AS userId, parent_id AS parentId, deleted_at IS NOT NULL AS deleted FROM messages WHERE id = ?')
      .get(id) as any;
    return r ? { ...r, deleted: !!r.deleted } : undefined;
  }

  /** Top-level messages, newest page first in the DB, returned oldest->newest. */
  listMessages(
    conversationId: number,
    opts: { before?: number; after?: number; around?: number; limit: number }
  ): { messages: Message[]; hasMore: boolean; hasNewer: boolean } {
    const q = (where: string, order: 'ASC' | 'DESC', limit: number, ...params: number[]) =>
      this.db
        .prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? AND m.parent_id IS NULL ${where} ORDER BY m.id ${order} LIMIT ?`)
        .all(conversationId, ...params, limit) as MessageRow[];

    if (opts.after !== undefined) {
      const rows = q('AND m.id > ?', 'ASC', opts.limit + 1, opts.after);
      const hasNewer = rows.length > opts.limit;
      return { messages: this.hydrate(rows.slice(0, opts.limit)), hasMore: false, hasNewer };
    }
    if (opts.around !== undefined) {
      const half = Math.max(1, Math.floor(opts.limit / 2));
      const older = q('AND m.id <= ?', 'DESC', half + 1, opts.around);
      const newer = q('AND m.id > ?', 'ASC', half + 1, opts.around);
      const hasMore = older.length > half;
      const hasNewer = newer.length > half;
      const rows = [...older.slice(0, half).reverse(), ...newer.slice(0, half)];
      return { messages: this.hydrate(rows), hasMore, hasNewer };
    }
    const rows =
      opts.before !== undefined
        ? q('AND m.id < ?', 'DESC', opts.limit + 1, opts.before)
        : q('', 'DESC', opts.limit + 1);
    const hasMore = rows.length > opts.limit;
    return { messages: this.hydrate(rows.slice(0, opts.limit).reverse()), hasMore, hasNewer: false };
  }

  listReplies(parentId: number): Message[] {
    const rows = this.db
      .prepare(`${MESSAGE_SELECT} WHERE m.parent_id = ? ORDER BY m.id ASC`)
      .all(parentId) as MessageRow[];
    return this.hydrate(rows);
  }

  createMessage(conversationId: number, userId: string, body: string, parentId: number | null): Message {
    if (parentId !== null) {
      const parent = this.getMessageMeta(parentId);
      if (!parent || parent.conversationId !== conversationId) throw new NotFoundError('Parent message not found');
      if (parent.parentId !== null) throw new BadRequestError('Replies cannot be nested; reply to the thread root');
      if (parent.deleted) throw new BadRequestError('Cannot reply to a deleted message');
    }
    const res = this.db
      .prepare('INSERT INTO messages (conversation_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(conversationId, userId, parentId, body, Date.now());
    const id = Number(res.lastInsertRowid);
    // Authors have implicitly read their own message.
    if (parentId === null) this.markRead(conversationId, userId, id);
    return this.getMessage(id)!;
  }

  editMessage(id: number, body: string): Message {
    this.db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ? AND deleted_at IS NULL').run(body, Date.now(), id);
    return this.getMessage(id)!;
  }

  deleteMessage(id: number): Message {
    this.db.prepare("UPDATE messages SET body = '', deleted_at = ? WHERE id = ? AND deleted_at IS NULL").run(Date.now(), id);
    this.db.prepare('DELETE FROM reactions WHERE message_id = ?').run(id);
    return this.getMessage(id)!;
  }

  // ------------------------------------------------------------ reactions

  toggleReaction(messageId: number, userId: string, emoji: string): { added: boolean; reactions: Reaction[] } {
    const del = this.db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, userId, emoji);
    let added = false;
    if (del.changes === 0) {
      this.db
        .prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)')
        .run(messageId, userId, emoji, Date.now());
      added = true;
    }
    return { added, reactions: this.getMessage(messageId)!.reactions };
  }

  removeReaction(messageId: number, userId: string, emoji: string): { removed: boolean; reactions: Reaction[] } {
    const del = this.db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, userId, emoji);
    return { removed: del.changes > 0, reactions: this.getMessage(messageId)!.reactions };
  }

  // --------------------------------------------------------------- search

  search(userId: string, rawQuery: string, limit: number) {
    const parsed = parseSearchQuery(rawQuery);
    const params: (string | number)[] = [];
    let sql: string;
    const filters: string[] = [];

    if (parsed.ftsQuery) {
      sql = `SELECT m.id AS id, snippet(messages_fts, 0, char(1), char(2), '…', 12) AS snippet
             FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
             JOIN conversations c ON c.id = m.conversation_id
             JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.user_id = ?
             WHERE messages_fts MATCH ? AND m.deleted_at IS NULL`;
      params.push(userId, parsed.ftsQuery);
    } else {
      sql = `SELECT m.id AS id, substr(m.body, 1, 160) AS snippet
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.user_id = ?
             WHERE m.deleted_at IS NULL`;
      params.push(userId);
    }
    if (parsed.from.length) {
      filters.push(
        `AND m.user_id IN (SELECT id FROM users WHERE ${parsed.from
          .map(() => "(handle LIKE ? ESCAPE '\\' OR name = ? COLLATE NOCASE)")
          .join(' OR ')})`
      );
      // from:maya matches handle prefixes (maya-okafor) or the exact display name; wildcards in input are escaped.
      for (const f of parsed.from) params.push(f.replace(/[\\%_]/g, '\\$&') + '%', f);
    }
    if (parsed.inChannels.length) {
      filters.push(
        `AND ((c.kind = 'channel' AND c.name COLLATE NOCASE IN (${parsed.inChannels.map(() => '?').join(',')}))${
          parsed.inChannels.includes('dm') ? " OR c.kind = 'dm'" : ''
        })`
      );
      params.push(...parsed.inChannels);
    }
    sql += ` ${filters.join(' ')} ORDER BY ${parsed.ftsQuery ? 'rank, ' : ''}m.id DESC LIMIT ?`;
    params.push(limit);

    let rows: { id: number; snippet: string }[];
    try {
      rows = this.db.prepare(sql).all(...params) as any;
    } catch (e: any) {
      if (String(e?.message).includes('fts5')) throw new BadRequestError('Invalid search query');
      throw e;
    }
    const messages = this.hydrate(
      rows.length
        ? (this.db
            .prepare(`${MESSAGE_SELECT} WHERE m.id IN (${rows.map(() => '?').join(',')})`)
            .all(...rows.map((r) => r.id)) as MessageRow[])
        : []
    );
    const byId = new Map(messages.map((m) => [m.id, m]));
    return {
      query: rawQuery,
      terms: parsed.terms,
      results: rows.map((r) => {
        const message = byId.get(r.id)!;
        const conv = this.getConversation(message.conversationId)!;
        return {
          message,
          snippet: r.snippet,
          conversation: { id: conv.id, kind: conv.kind, name: conv.name, memberIds: conv.kind === 'dm' ? this.memberIds(conv.id) : [] },
        };
      }),
    };
  }
}
