import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, mkChannel, signup, type Client, type TestUser } from './helpers.js';

describe('channels and messages', () => {
  let app: FastifyInstance;
  let alice: TestUser, bob: TestUser;
  let a: Client, b: Client;

  beforeAll(async () => {
    app = await makeApp();
    alice = await signup(app, 'Alice');
    bob = await signup(app, 'Bob');
    a = client(app, alice);
    b = client(app, bob);
  });
  afterAll(() => app.close());

  it('creates, lists, and validates channels', async () => {
    const r = await a.post('/api/channels', { name: 'Project-X', topic: 'secret project' });
    expect(r.status).toBe(201);
    expect(r.json.channel).toMatchObject({ name: 'project-x', topic: 'secret project', memberCount: 1, joined: true });

    expect((await a.post('/api/channels', { name: 'project-x' })).status).toBe(409);
    for (const name of ['', 'has space', '-lead', 'a'.repeat(41), "x'; DROP TABLE users;--"]) {
      expect((await a.post('/api/channels', { name })).status, name).toBe(400);
    }

    const listB = (await b.get('/api/channels')).json.channels;
    const px = listB.find((c: any) => c.name === 'project-x');
    expect(px).toMatchObject({ joined: false, memberCount: 1 });
    // Table survived the injection attempt
    expect((await a.get('/api/users')).status).toBe(200);
  });

  it('join and leave update membership and conversation lists', async () => {
    const id = await mkChannel(a, 'join-leave');
    expect((await b.get('/api/conversations')).json.conversations.some((c: any) => c.id === id)).toBe(false);

    const join = await b.post(`/api/channels/${id}/join`);
    expect(join.status).toBe(200);
    expect(join.json.joined).toBe(true);
    expect((await b.post(`/api/channels/${id}/join`)).json.joined).toBe(false); // idempotent
    expect((await b.get('/api/conversations')).json.conversations.some((c: any) => c.id === id)).toBe(true);
    expect((await a.get('/api/channels')).json.channels.find((c: any) => c.id === id).memberCount).toBe(2);

    const leave = await b.post(`/api/channels/${id}/leave`);
    expect(leave.json.left).toBe(true);
    expect((await b.get(`/api/conversations/${id}`)).status).toBe(403);
    expect((await b.post('/api/channels/99999/join')).status).toBe(404);
  });

  it('enforces membership on reading and writing messages', async () => {
    const id = await mkChannel(a, 'members-only');
    expect((await a.post(`/api/conversations/${id}/messages`, { body: 'hello' })).status).toBe(201);
    expect((await b.get(`/api/conversations/${id}/messages`)).status).toBe(403);
    expect((await b.post(`/api/conversations/${id}/messages`, { body: 'sneak' })).status).toBe(403);
    expect((await b.post(`/api/conversations/${id}/read`, {})).status).toBe(403);
    expect((await b.get(`/api/conversations/${id}`)).status).toBe(403);
    expect((await b.get('/api/conversations/424242/messages')).status).toBe(404);
    // after joining, access is granted
    await b.post(`/api/channels/${id}/join`);
    const list = await b.get(`/api/conversations/${id}/messages`);
    expect(list.status).toBe(200);
    expect(list.json.messages).toHaveLength(1);
  });

  it('validates message bodies', async () => {
    const id = await mkChannel(a, 'validation');
    for (const payload of [{}, { body: '' }, { body: '   \n ' }, { body: 'x'.repeat(4001) }, { body: 'ok', extra: true, parentId: 0 }]) {
      const r = await a.post(`/api/conversations/${id}/messages`, payload);
      expect(r.status, JSON.stringify(payload).slice(0, 40)).toBe(400);
    }
    const r = await a.post(`/api/conversations/${id}/messages`, { body: '  <script>alert(1)</script>  ' });
    expect(r.status).toBe(201);
    expect(r.json.message.body).toBe('<script>alert(1)</script>'); // stored as plain text, trimmed
    expect((await a.get(`/api/conversations/${id}/messages?limit=0`)).status).toBe(400);
    expect((await a.get(`/api/conversations/${id}/messages?before=abc`)).status).toBe(400);
    expect((await a.get(`/api/conversations/${id}/messages?before=5&after=1`)).status).toBe(400);
  });

  it('paginates with a before cursor', async () => {
    const id = await mkChannel(a, 'paging');
    const ids: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const r = await a.post(`/api/conversations/${id}/messages`, { body: `msg ${i}` });
      ids.push(r.json.message.id);
    }
    const p1 = (await a.get(`/api/conversations/${id}/messages?limit=5`)).json;
    expect(p1.messages.map((m: any) => m.body)).toEqual(['msg 8', 'msg 9', 'msg 10', 'msg 11', 'msg 12']);
    expect(p1.hasMore).toBe(true);

    const p2 = (await a.get(`/api/conversations/${id}/messages?limit=5&before=${p1.messages[0].id}`)).json;
    expect(p2.messages.map((m: any) => m.body)).toEqual(['msg 3', 'msg 4', 'msg 5', 'msg 6', 'msg 7']);
    expect(p2.hasMore).toBe(true);

    const p3 = (await a.get(`/api/conversations/${id}/messages?limit=5&before=${p2.messages[0].id}`)).json;
    expect(p3.messages.map((m: any) => m.body)).toEqual(['msg 1', 'msg 2']);
    expect(p3.hasMore).toBe(false);

    const newer = (await a.get(`/api/conversations/${id}/messages?after=${ids[9]}`)).json;
    expect(newer.messages.map((m: any) => m.body)).toEqual(['msg 11', 'msg 12']);

    const around = (await a.get(`/api/conversations/${id}/messages?around=${ids[5]}&limit=6`)).json;
    expect(around.messages.map((m: any) => m.body)).toEqual(['msg 4', 'msg 5', 'msg 6', 'msg 7', 'msg 8', 'msg 9']);
    expect(around.hasMore).toBe(true);
    expect(around.hasNewer).toBe(true);
  });

  it('lets only the author edit or delete, and soft-deletes content', async () => {
    const id = await mkChannel(a, 'editing');
    await b.post(`/api/channels/${id}/join`);
    const m = (await a.post(`/api/conversations/${id}/messages`, { body: 'first draft' })).json.message;

    expect((await b.patch(`/api/messages/${m.id}`, { body: 'hijack' })).status).toBe(403);
    expect((await b.del(`/api/messages/${m.id}`)).status).toBe(403);

    const edited = await a.patch(`/api/messages/${m.id}`, { body: 'final draft' });
    expect(edited.status).toBe(200);
    expect(edited.json.message.body).toBe('final draft');
    expect(edited.json.message.editedAt).toBeTypeOf('number');
    expect((await a.patch(`/api/messages/${m.id}`, { body: '  ' })).status).toBe(400);

    const del = await a.del(`/api/messages/${m.id}`);
    expect(del.status).toBe(200);
    expect(del.json.message).toMatchObject({ deleted: true, body: '' });
    expect((await a.patch(`/api/messages/${m.id}`, { body: 'zombie' })).status).toBe(400);
    const list = (await b.get(`/api/conversations/${id}/messages`)).json.messages;
    expect(list[0]).toMatchObject({ id: m.id, deleted: true, body: '' });
    expect((await a.patch('/api/messages/987654', { body: 'x' })).status).toBe(404);
  });

  it('tracks unread counts per conversation and clears them on mark-read', async () => {
    const id = await mkChannel(a, 'unread-test');
    await b.post(`/api/channels/${id}/join`);
    const unread = async (c: Client) => (await c.get(`/api/conversations/${id}`)).json.conversation.unread;

    expect(await unread(b)).toBe(0); // joining does not flood unread
    await a.post(`/api/conversations/${id}/messages`, { body: 'one' });
    await a.post(`/api/conversations/${id}/messages`, { body: 'two' });
    const last = (await a.post(`/api/conversations/${id}/messages`, { body: 'three' })).json.message;
    expect(await unread(b)).toBe(3);
    expect(await unread(a)).toBe(0); // own messages are never unread

    // thread replies do not bump the channel unread badge
    await a.post(`/api/conversations/${id}/messages`, { body: 'in thread', parentId: last.id });
    expect(await unread(b)).toBe(3);

    const summary = (await b.get('/api/conversations')).json.conversations.find((c: any) => c.id === id);
    expect(summary.unread).toBe(3);
    expect(summary.lastMessage.body).toBe('in thread');

    const read = await b.post(`/api/conversations/${id}/read`, {});
    expect(read.status).toBe(200);
    expect(await unread(b)).toBe(0);

    // a bogus far-future messageId must not suppress future unread
    await b.post(`/api/conversations/${id}/read`, { messageId: 10_000_000 });
    await a.post(`/api/conversations/${id}/messages`, { body: 'four' });
    expect(await unread(b)).toBe(1);

    // partial read: marking an older message than the current marker is a no-op, a newer one advances it
    await a.post(`/api/conversations/${id}/messages`, { body: 'five' });
    const latest = (await b.get(`/api/conversations/${id}/messages?limit=2`)).json.messages; // [four, five]
    await b.post(`/api/conversations/${id}/read`, { messageId: 1 });
    expect(await unread(b)).toBe(2);
    await b.post(`/api/conversations/${id}/read`, { messageId: latest[0].id });
    expect(await unread(b)).toBe(1);
  });
});
