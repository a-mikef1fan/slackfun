import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

const HEARTBEAT_MS = 30_000;

export async function registerWs(app: FastifyInstance): Promise<void> {
  const { store, hub } = app;
  const alive = new WeakMap<WebSocket, boolean>();

  const timer = setInterval(() => {
    for (const s of hub.allSockets()) {
      if (alive.get(s) === false) {
        s.terminate();
        continue;
      }
      alive.set(s, false);
      try {
        s.ping();
      } catch {
        /* socket already closing */
      }
    }
  }, HEARTBEAT_MS);
  timer.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    for (const s of hub.allSockets()) s.terminate();
  });

  app.get<{ Querystring: { token?: string } }>(
    '/ws',
    {
      websocket: true,
      // Runs before the upgrade, so bad tokens get a plain 401.
      preValidation: async (req, reply) => {
        const token = req.query.token;
        if (!token || !store.getUser(token)) return reply.code(401).send({ error: 'Unauthorized' });
        req.userId = token;
      },
    },
    (socket: WebSocket, req) => {
      const userId = req.userId;
      alive.set(socket, true);
      socket.on('pong', () => alive.set(socket, true));

      const cameOnline = hub.add(userId, socket);
      hub.toSocket(socket, { type: 'hello', userId, online: hub.online() });
      if (cameOnline) hub.toAll({ type: 'presence', userId, online: true });

      socket.on('message', (raw) => {
        alive.set(socket, true);
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return hub.toSocket(socket, { type: 'error', message: 'Invalid JSON' });
        }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'ping') return hub.toSocket(socket, { type: 'pong' });
        if (msg.type === 'typing') {
          const conversationId = msg.conversationId;
          if (!Number.isInteger(conversationId) || !store.isMember(conversationId, userId)) {
            return hub.toSocket(socket, { type: 'error', message: 'Not a member of that conversation' });
          }
          const parentId = Number.isInteger(msg.parentId) ? msg.parentId : null;
          hub.toConversation(conversationId, { type: 'typing', conversationId, parentId, userId }, userId);
          return;
        }
        hub.toSocket(socket, { type: 'error', message: 'Unknown message type' });
      });

      socket.on('close', () => {
        if (hub.remove(userId, socket)) hub.toAll({ type: 'presence', userId, online: false });
      });
      socket.on('error', () => socket.terminate());
    }
  );
}
