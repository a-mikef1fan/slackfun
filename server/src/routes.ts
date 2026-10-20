import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseSearchQuery } from './search.js';
import { BadRequestError, ForbiddenError, NotFoundError } from './store.js';

const idParam = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

const MAX_BODY = 4000;

function cleanBody(raw: string): string {
  const body = raw.replace(/\r\n/g, '\n').trim();
  if (!body) throw new BadRequestError('Message cannot be empty');
  return body;
}

// Emoji only: must contain a pictograph and no letters/digits/whitespace/markup characters.
function assertEmoji(emoji: string): void {
  const ok = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(emoji) && !/[\p{L}\p{N}\s<>&"'`]/u.test(emoji);
  if (!ok) throw new BadRequestError('Reaction must be a single emoji');
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const x = req.headers['x-user-id'];
  return typeof x === 'string' ? x : undefined;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const { store, hub } = app;

  const requireMember = (conversationId: number, userId: string) => {
    const conv = store.getConversation(conversationId);
    if (!conv) throw new NotFoundError('Conversation not found');
    if (!store.isMember(conversationId, userId)) throw new ForbiddenError('You are not a member of this conversation');
    return conv;
  };

  const requireMessage = (messageId: number, userId: string) => {
    const meta = store.getMessageMeta(messageId);
    if (!meta) throw new NotFoundError('Message not found');
    requireMember(meta.conversationId, userId);
    return meta;
  };

  // ------------------------------------------------------------ public

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/demo-users', async () => ({ users: store.listDemoUsers() }));

  app.post<{ Body: { name: string } }>(
    '/api/users',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 40 } },
        },
      },
    },
    async (req, reply) => {
      const name = req.body.name.trim().replace(/\s+/g, ' ');
      if (!name || /[\u0000-\u001f\u007f<>]/.test(name)) throw new BadRequestError('Invalid name');
      const { user, created } = store.findOrCreateUser(name);
      if (created) {
        for (const c of store.listConversations(user.id)) {
          hub.toAll({ type: 'member.joined', conversationId: c.id, userId: user.id });
        }
      }
      return reply.code(created ? 201 : 200).send({ user, token: user.id });
    }
  );

  // ----------------------------------------------------- authenticated

  await app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      const token = bearer(req);
      const user = token ? store.getUser(token) : undefined;
      if (!user) return reply.code(401).send({ error: 'Unauthorized' });
      req.userId = user.id;
    });

    api.get('/api/me', async (req) => ({ user: store.getUser(req.userId) }));

    api.get('/api/users', async () => {
      const online = new Set(hub.online());
      return { users: store.listUsers().map((u) => ({ ...u, online: online.has(u.id) })) };
    });

    // ---- channels
    api.get('/api/channels', async (req) => ({ channels: store.listChannels(req.userId) }));

    api.post<{ Body: { name: string; topic?: string } }>(
      '/api/channels',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$' },
              topic: { type: 'string', maxLength: 200 },
            },
          },
        },
      },
      async (req, reply) => {
        const id = store.createChannel(req.userId, req.body.name.toLowerCase(), (req.body.topic ?? '').trim());
        const channel = store.getChannelListing(id, req.userId)!;
        hub.toAll({ type: 'channel.created', channel });
        hub.toUser(req.userId, { type: 'conversation.new', conversation: store.getConversationSummary(id, req.userId)! });
        return reply.code(201).send({ channel, conversation: store.getConversationSummary(id, req.userId) });
      }
    );

    api.post<{ Params: { id: number } }>('/api/channels/:id/join', { schema: { params: idParam } }, async (req) => {
      const conv = store.getConversation(req.params.id);
      if (!conv || conv.kind !== 'channel') throw new NotFoundError('Channel not found');
      const joined = store.addMember(conv.id, req.userId);
      const conversation = store.getConversationSummary(conv.id, req.userId)!;
      if (joined) {
        hub.toUser(req.userId, { type: 'conversation.new', conversation });
        hub.toConversation(conv.id, { type: 'member.joined', conversationId: conv.id, userId: req.userId });
      }
      return { conversation, joined };
    });

    api.post<{ Params: { id: number } }>('/api/channels/:id/leave', { schema: { params: idParam } }, async (req) => {
      const conv = store.getConversation(req.params.id);
      if (!conv || conv.kind !== 'channel') throw new NotFoundError('Channel not found');
      const left = store.removeMember(conv.id, req.userId);
      if (left) {
        const ev = { type: 'member.left', conversationId: conv.id, userId: req.userId } as const;
        hub.toUser(req.userId, ev);
        hub.toConversation(conv.id, ev);
      }
      return { left };
    });

    // ---- conversations & DMs
    api.get('/api/conversations', async (req) => ({ conversations: store.listConversations(req.userId) }));

    api.get<{ Params: { id: number } }>('/api/conversations/:id', { schema: { params: idParam } }, async (req) => {
      requireMember(req.params.id, req.userId);
      return { conversation: store.getConversationSummary(req.params.id, req.userId) };
    });

    api.post<{ Body: { userIds: string[] } }>(
      '/api/dms',
      {
        schema: {
          body: {
            type: 'object',
            required: ['userIds'],
            additionalProperties: false,
            properties: {
              userIds: { type: 'array', items: { type: 'string', maxLength: 64 }, minItems: 1, maxItems: 8, uniqueItems: true },
            },
          },
        },
      },
      async (req, reply) => {
        const others = req.body.userIds.filter((u) => u !== req.userId);
        if (others.length === 0) throw new BadRequestError('Pick at least one other person');
        for (const u of others) if (!store.getUser(u)) throw new NotFoundError('Unknown user');
        const { id, created } = store.findOrCreateDm([req.userId, ...others]);
        if (created) {
          for (const uid of store.memberIds(id)) {
            hub.toUser(uid, { type: 'conversation.new', conversation: store.getConversationSummary(id, uid)! });
          }
        }
        return reply.code(created ? 201 : 200).send({ conversation: store.getConversationSummary(id, req.userId) });
      }
    );

    api.post<{ Params: { id: number }; Body: { messageId?: number } }>(
      '/api/conversations/:id/read',
      {
        schema: {
          params: idParam,
          body: { type: 'object', additionalProperties: false, properties: { messageId: { type: 'integer', minimum: 0 } } },
        },
      },
      async (req) => {
        requireMember(req.params.id, req.userId);
        const lastReadId = store.markRead(req.params.id, req.userId, req.body?.messageId);
        hub.toUser(req.userId, { type: 'read', conversationId: req.params.id, lastReadId });
        return { lastReadId };
      }
    );

    // ---- messages
    api.get<{ Params: { id: number }; Querystring: { before?: number; after?: number; around?: number; limit?: number } }>(
      '/api/conversations/:id/messages',
      {
        schema: {
          params: idParam,
          querystring: {
            type: 'object',
            properties: {
              before: { type: 'integer', minimum: 1 },
              after: { type: 'integer', minimum: 0 },
              around: { type: 'integer', minimum: 1 },
              limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            },
          },
        },
      },
      async (req) => {
        requireMember(req.params.id, req.userId);
        const { before, after, around, limit = 50 } = req.query;
        if ([before, after, around].filter((x) => x !== undefined).length > 1) {
          throw new BadRequestError('Use only one of before, after, around');
        }
        return store.listMessages(req.params.id, { before, after, around, limit });
      }
    );

    api.post<{ Params: { id: number }; Body: { body: string; parentId?: number } }>(
      '/api/conversations/:id/messages',
      {
        schema: {
          params: idParam,
          body: {
            type: 'object',
            required: ['body'],
            additionalProperties: false,
            properties: {
              body: { type: 'string', minLength: 1, maxLength: MAX_BODY },
              parentId: { type: 'integer', minimum: 1 },
            },
          },
        },
      },
      async (req, reply) => {
        requireMember(req.params.id, req.userId);
        const message = store.createMessage(req.params.id, req.userId, cleanBody(req.body.body), req.body.parentId ?? null);
        hub.toConversation(message.conversationId, { type: 'message.new', message });
        if (message.parentId !== null) {
          const parent = store.getMessage(message.parentId)!;
          hub.toConversation(message.conversationId, {
            type: 'thread.updated',
            conversationId: message.conversationId,
            parentId: parent.id,
            replyCount: parent.replyCount,
            lastReplyAt: parent.lastReplyAt,
            lastReplyUserId: parent.lastReplyUserId,
          });
        }
        return reply.code(201).send({ message });
      }
    );

    api.get<{ Params: { id: number } }>('/api/messages/:id/thread', { schema: { params: idParam } }, async (req) => {
      const meta = requireMessage(req.params.id, req.userId);
      const rootId = meta.parentId ?? meta.id;
      return { parent: store.getMessage(rootId), replies: store.listReplies(rootId) };
    });

    api.patch<{ Params: { id: number }; Body: { body: string } }>(
      '/api/messages/:id',
      {
        schema: {
          params: idParam,
          body: {
            type: 'object',
            required: ['body'],
            additionalProperties: false,
            properties: { body: { type: 'string', minLength: 1, maxLength: MAX_BODY } },
          },
        },
      },
      async (req) => {
        const meta = requireMessage(req.params.id, req.userId);
        if (meta.userId !== req.userId) throw new ForbiddenError('You can only edit your own messages');
        if (meta.deleted) throw new BadRequestError('Message was deleted');
        const message = store.editMessage(meta.id, cleanBody(req.body.body));
        hub.toConversation(message.conversationId, { type: 'message.updated', message });
        return { message };
      }
    );

    api.delete<{ Params: { id: number } }>('/api/messages/:id', { schema: { params: idParam } }, async (req) => {
      const meta = requireMessage(req.params.id, req.userId);
      if (meta.userId !== req.userId) throw new ForbiddenError('You can only delete your own messages');
      const message = store.deleteMessage(meta.id);
      hub.toConversation(message.conversationId, { type: 'message.deleted', message });
      if (message.parentId !== null) {
        const parent = store.getMessage(message.parentId)!;
        hub.toConversation(message.conversationId, {
          type: 'thread.updated',
          conversationId: message.conversationId,
          parentId: parent.id,
          replyCount: parent.replyCount,
          lastReplyAt: parent.lastReplyAt,
          lastReplyUserId: parent.lastReplyUserId,
        });
      }
      return { message };
    });

    // ---- reactions
    api.post<{ Params: { id: number }; Body: { emoji: string } }>(
      '/api/messages/:id/reactions',
      {
        schema: {
          params: idParam,
          body: {
            type: 'object',
            required: ['emoji'],
            additionalProperties: false,
            properties: { emoji: { type: 'string', minLength: 1, maxLength: 32 } },
          },
        },
      },
      async (req) => {
        const meta = requireMessage(req.params.id, req.userId);
        if (meta.deleted) throw new BadRequestError('Message was deleted');
        assertEmoji(req.body.emoji);
        const { added, reactions } = store.toggleReaction(meta.id, req.userId, req.body.emoji);
        hub.toConversation(meta.conversationId, {
          type: 'reaction.updated',
          conversationId: meta.conversationId,
          messageId: meta.id,
          parentId: meta.parentId,
          reactions,
        });
        return { added, reactions };
      }
    );

    api.delete<{ Params: { id: number; emoji: string } }>(
      '/api/messages/:id/reactions/:emoji',
      {
        schema: {
          params: {
            type: 'object',
            required: ['id', 'emoji'],
            properties: { id: { type: 'integer', minimum: 1 }, emoji: { type: 'string', minLength: 1, maxLength: 32 } },
          },
        },
      },
      async (req) => {
        const meta = requireMessage(req.params.id, req.userId);
        const { removed, reactions } = store.removeReaction(meta.id, req.userId, req.params.emoji);
        if (removed) {
          hub.toConversation(meta.conversationId, {
            type: 'reaction.updated',
            conversationId: meta.conversationId,
            messageId: meta.id,
            parentId: meta.parentId,
            reactions,
          });
        }
        return { removed, reactions };
      }
    );

    // ---- search
    api.get<{ Querystring: { q: string; limit?: number } }>(
      '/api/search',
      {
        schema: {
          querystring: {
            type: 'object',
            required: ['q'],
            properties: {
              q: { type: 'string', minLength: 1, maxLength: 200 },
              limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
            },
          },
        },
      },
      async (req) => {
        const p = parseSearchQuery(req.query.q);
        if (!p.ftsQuery && !p.from.length && !p.inChannels.length) throw new BadRequestError('Empty query');
        return store.search(req.userId, req.query.q, req.query.limit ?? 30);
      }
    );
  });
}
