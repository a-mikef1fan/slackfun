import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, signup, type Client, type TestUser } from './helpers.js';

describe('direct messages', () => {
  let app: FastifyInstance;
  let u: Record<string, TestUser>;
  let c: Record<string, Client>;

  beforeAll(async () => {
    app = await makeApp();
    u = {};
    c = {};
    for (const n of ['ann', 'ben', 'cat', 'dan']) {
      u[n] = await signup(app, n);
      c[n] = client(app, u[n]);
    }
  });
  afterAll(() => app.close());

  it('finds or creates a 1:1 DM regardless of who starts it', async () => {
    const first = await c.ann.post('/api/dms', { userIds: [u.ben.id] });
    expect(first.status).toBe(201);
    expect(first.json.conversation.kind).toBe('dm');
    expect(first.json.conversation.memberIds.sort()).toEqual([u.ann.id, u.ben.id].sort());

    const again = await c.ann.post('/api/dms', { userIds: [u.ben.id] });
    expect(again.status).toBe(200);
    expect(again.json.conversation.id).toBe(first.json.conversation.id);

    const reverse = await c.ben.post('/api/dms', { userIds: [u.ann.id] });
    expect(reverse.json.conversation.id).toBe(first.json.conversation.id);

    // including yourself explicitly makes no difference
    const withSelf = await c.ben.post('/api/dms', { userIds: [u.ben.id, u.ann.id] });
    expect(withSelf.json.conversation.id).toBe(first.json.conversation.id);
  });

  it('find-or-creates group DMs by member set', async () => {
    const g1 = await c.ann.post('/api/dms', { userIds: [u.ben.id, u.cat.id] });
    expect(g1.status).toBe(201);
    expect(g1.json.conversation.memberIds).toHaveLength(3);
    const g2 = await c.cat.post('/api/dms', { userIds: [u.ann.id, u.ben.id] });
    expect(g2.status).toBe(200);
    expect(g2.json.conversation.id).toBe(g1.json.conversation.id);
    const other = await c.ann.post('/api/dms', { userIds: [u.ben.id, u.cat.id, u.dan.id] });
    expect(other.status).toBe(201);
    expect(other.json.conversation.id).not.toBe(g1.json.conversation.id);
  });

  it('validates DM requests', async () => {
    expect((await c.ann.post('/api/dms', { userIds: [] })).status).toBe(400);
    expect((await c.ann.post('/api/dms', { userIds: [u.ann.id] })).status).toBe(400); // only yourself
    expect((await c.ann.post('/api/dms', { userIds: [u.ben.id, u.ben.id] })).status).toBe(400); // duplicates
    expect((await c.ann.post('/api/dms', { userIds: ['00000000-0000-0000-0000-000000000000'] })).status).toBe(404);
    expect((await c.ann.post('/api/dms', {})).status).toBe(400);
  });

  it('keeps DM content private to members', async () => {
    const dm = (await c.ann.post('/api/dms', { userIds: [u.cat.id] })).json.conversation;
    await c.ann.post(`/api/conversations/${dm.id}/messages`, { body: 'secret plans' });
    expect((await c.ben.get(`/api/conversations/${dm.id}/messages`)).status).toBe(403);
    expect((await c.ben.post(`/api/conversations/${dm.id}/messages`, { body: 'intrude' })).status).toBe(403);
    expect((await c.ben.post(`/api/channels/${dm.id}/join`)).status).toBe(404); // DMs are not joinable
    expect((await c.ben.get('/api/channels')).json.channels.some((x: any) => x.id === dm.id)).toBe(false);
    expect((await c.ben.get('/api/conversations')).json.conversations.some((x: any) => x.id === dm.id)).toBe(false);

    const received = (await c.cat.get(`/api/conversations/${dm.id}/messages`)).json.messages;
    expect(received.map((m: any) => m.body)).toEqual(['secret plans']);
    expect((await c.cat.get(`/api/conversations/${dm.id}`)).json.conversation.unread).toBe(1);
  });
});
