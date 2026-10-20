import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, mkChannel, signup, type Client, type TestUser } from './helpers.js';

describe('threads', () => {
  let app: FastifyInstance;
  let alice: TestUser, bob: TestUser, eve: TestUser;
  let a: Client, b: Client, e: Client;
  let chan: number;

  beforeAll(async () => {
    app = await makeApp();
    alice = await signup(app, 'Alice');
    bob = await signup(app, 'Bob');
    eve = await signup(app, 'Eve');
    a = client(app, alice);
    b = client(app, bob);
    e = client(app, eve);
    chan = await mkChannel(a, 'threads');
    await b.post(`/api/channels/${chan}/join`);
  });
  afterAll(() => app.close());

  it('creates replies, tracks reply count and last reply on the parent', async () => {
    const parent = (await a.post(`/api/conversations/${chan}/messages`, { body: 'Question?' })).json.message;
    expect(parent).toMatchObject({ replyCount: 0, lastReplyAt: null });

    const r1 = await b.post(`/api/conversations/${chan}/messages`, { body: 'Answer one', parentId: parent.id });
    expect(r1.status).toBe(201);
    expect(r1.json.message.parentId).toBe(parent.id);
    const r2 = await a.post(`/api/conversations/${chan}/messages`, { body: 'Thanks!', parentId: parent.id });

    const top = (await a.get(`/api/conversations/${chan}/messages`)).json.messages;
    expect(top).toHaveLength(1); // replies are not in the channel timeline
    expect(top[0]).toMatchObject({ id: parent.id, replyCount: 2, lastReplyUserId: alice.id });
    expect(top[0].lastReplyAt).toBe(r2.json.message.createdAt);

    const thread = (await b.get(`/api/messages/${parent.id}/thread`)).json;
    expect(thread.parent.id).toBe(parent.id);
    expect(thread.replies.map((m: any) => m.body)).toEqual(['Answer one', 'Thanks!']);

    // fetching the thread via a reply id resolves to the root
    const viaReply = (await b.get(`/api/messages/${r1.json.message.id}/thread`)).json;
    expect(viaReply.parent.id).toBe(parent.id);
  });

  it('rejects invalid thread operations', async () => {
    const parent = (await a.post(`/api/conversations/${chan}/messages`, { body: 'root' })).json.message;
    const reply = (await a.post(`/api/conversations/${chan}/messages`, { body: 'child', parentId: parent.id })).json.message;
    // nested replies
    expect((await a.post(`/api/conversations/${chan}/messages`, { body: 'grandchild', parentId: reply.id })).status).toBe(400);
    // parent from another conversation
    const other = await mkChannel(a, 'threads-other');
    expect((await a.post(`/api/conversations/${other}/messages`, { body: 'x', parentId: parent.id })).status).toBe(404);
    // missing parent
    expect((await a.post(`/api/conversations/${chan}/messages`, { body: 'x', parentId: 999999 })).status).toBe(404);
  });

  it('enforces membership on thread reads and writes', async () => {
    const parent = (await a.post(`/api/conversations/${chan}/messages`, { body: 'members only thread' })).json.message;
    expect((await e.get(`/api/messages/${parent.id}/thread`)).status).toBe(403);
    expect((await e.post(`/api/conversations/${chan}/messages`, { body: 'x', parentId: parent.id })).status).toBe(403);
    expect((await e.get('/api/messages/999999/thread')).status).toBe(404);
  });

  it('updates the reply count when a reply is deleted, and keeps tombstones for deleted parents', async () => {
    const parent = (await a.post(`/api/conversations/${chan}/messages`, { body: 'to be removed' })).json.message;
    const r = (await b.post(`/api/conversations/${chan}/messages`, { body: 'reply', parentId: parent.id })).json.message;
    await b.del(`/api/messages/${r.id}`);
    const after = (await a.get(`/api/messages/${parent.id}/thread`)).json;
    expect(after.parent.replyCount).toBe(0);
    expect(after.replies[0]).toMatchObject({ deleted: true, body: '' });

    await a.del(`/api/messages/${parent.id}`);
    const res = await b.post(`/api/conversations/${chan}/messages`, { body: 'late reply', parentId: parent.id });
    expect(res.status).toBe(400);
  });
});
