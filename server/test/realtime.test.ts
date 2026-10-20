import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, connectWs, makeApp, mkChannel, signup, sleep, WsClient, type Client, type TestUser } from './helpers.js';

describe('realtime over WebSocket', () => {
  let app: FastifyInstance;
  let base: string;
  let alice: TestUser, bob: TestUser, eve: TestUser;
  let a: Client, b: Client, e: Client;
  let chan: number;
  const open: WsClient[] = [];
  const connect = async (u: TestUser) => {
    const c = await connectWs(base, u.token);
    open.push(c);
    return c;
  };

  beforeAll(async () => {
    app = await makeApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}`;
    alice = await signup(app, 'Alice');
    bob = await signup(app, 'Bob');
    eve = await signup(app, 'Eve');
    a = client(app, alice);
    b = client(app, bob);
    e = client(app, eve);
    chan = await mkChannel(a, 'live');
    await b.post(`/api/channels/${chan}/join`);
  });
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.close()));
  });
  afterAll(() => app.close());

  it('rejects connections without a valid token', async () => {
    const bad = new WsClient(`${base.replace('http', 'ws')}/ws?token=nope`);
    await expect(bad.opened()).rejects.toThrow(/401/);
    const none = new WsClient(`${base.replace('http', 'ws')}/ws`);
    await expect(none.opened()).rejects.toThrow(/401/);
  });

  it('delivers a new message from one client to another in real time', async () => {
    const wa = await connect(alice);
    const wb = await connect(bob);
    const hello = await wb.waitFor((ev) => ev.type === 'hello');
    expect(hello.userId).toBe(bob.id);

    const sent = await a.post(`/api/conversations/${chan}/messages`, { body: 'hello bob, live!' });
    const ev = await wb.waitFor((x) => x.type === 'message.new');
    expect(ev.message).toMatchObject({ id: sent.json.message.id, body: 'hello bob, live!', userId: alice.id, conversationId: chan });
    // sender's own socket also hears it (multi-tab consistency)
    await wa.waitFor((x) => x.type === 'message.new' && x.message.id === sent.json.message.id);
  });

  it('does not deliver events to non-members', async () => {
    const we = await connect(eve);
    const wb = await connect(bob);
    await a.post(`/api/conversations/${chan}/messages`, { body: 'members only broadcast' });
    await wb.waitFor((x) => x.type === 'message.new' && x.message.body === 'members only broadcast');
    await sleep(100);
    expect(we.events.some((x) => x.type === 'message.new')).toBe(false);
  });

  it('broadcasts edits, deletes, reactions and thread replies', async () => {
    const wb = await connect(bob);
    const m = (await a.post(`/api/conversations/${chan}/messages`, { body: 'v1' })).json.message;
    await wb.waitFor((x) => x.type === 'message.new' && x.message.id === m.id);

    await a.patch(`/api/messages/${m.id}`, { body: 'v2' });
    const upd = await wb.waitFor((x) => x.type === 'message.updated' && x.message.id === m.id);
    expect(upd.message.body).toBe('v2');
    expect(upd.message.editedAt).toBeTypeOf('number');

    await a.post(`/api/messages/${m.id}/reactions`, { emoji: '🎉' });
    const rx = await wb.waitFor((x) => x.type === 'reaction.updated' && x.messageId === m.id);
    expect(rx.reactions).toEqual([{ emoji: '🎉', count: 1, userIds: [alice.id] }]);

    const reply = (await a.post(`/api/conversations/${chan}/messages`, { body: 'in thread', parentId: m.id })).json.message;
    const re = await wb.waitFor((x) => x.type === 'message.new' && x.message.id === reply.id);
    expect(re.message.parentId).toBe(m.id);
    const tu = await wb.waitFor((x) => x.type === 'thread.updated' && x.parentId === m.id);
    expect(tu).toMatchObject({ replyCount: 1, lastReplyUserId: alice.id });

    await a.del(`/api/messages/${m.id}`);
    const del = await wb.waitFor((x) => x.type === 'message.deleted' && x.message.id === m.id);
    expect(del.message).toMatchObject({ deleted: true, body: '' });
  });

  it('relays typing indicators to other members only', async () => {
    const wa = await connect(alice);
    const wb = await connect(bob);
    const we = await connect(eve);
    await wb.waitFor((x) => x.type === 'hello');
    wa.send({ type: 'typing', conversationId: chan });
    const ev = await wb.waitFor((x) => x.type === 'typing');
    expect(ev).toMatchObject({ conversationId: chan, userId: alice.id, parentId: null });
    await sleep(100);
    expect(wa.events.some((x) => x.type === 'typing')).toBe(false); // not echoed to sender
    expect(we.events.some((x) => x.type === 'typing')).toBe(false); // non-member

    // typing in a conversation you're not part of is refused
    we.send({ type: 'typing', conversationId: chan });
    const err = await we.waitFor((x) => x.type === 'error');
    expect(err.message).toMatch(/member/i);
  });

  it('reports presence changes and the online list', async () => {
    const wb = await connect(bob);
    await wb.waitFor((x) => x.type === 'hello');
    const wa = await connect(alice);
    const online = await wb.waitFor((x) => x.type === 'presence' && x.userId === alice.id && x.online);
    expect(online.online).toBe(true);
    const helloA = await wa.waitFor((x) => x.type === 'hello');
    expect(helloA.online).toEqual(expect.arrayContaining([alice.id, bob.id]));
    expect((await a.get('/api/users')).json.users.find((u: any) => u.id === alice.id).online).toBe(true);

    // a second tab does not re-announce; closing one tab keeps the user online
    const wa2 = await connect(alice);
    await wa2.waitFor((x) => x.type === 'hello');
    await wa.close();
    await sleep(100);
    expect(wb.events.some((x) => x.type === 'presence' && x.userId === alice.id && x.online === false)).toBe(false);
    await wa2.close();
    const off = await wb.waitFor((x) => x.type === 'presence' && x.userId === alice.id && x.online === false);
    expect(off.online).toBe(false);
  });

  it('pushes new DMs, channel joins and read markers to the right users', async () => {
    const wb = await connect(bob);
    const we = await connect(eve);
    await wb.waitFor((x) => x.type === 'hello');
    const dm = (await a.post('/api/dms', { userIds: [bob.id] })).json.conversation;
    const ev = await wb.waitFor((x) => x.type === 'conversation.new' && x.conversation.id === dm.id);
    expect(ev.conversation.kind).toBe('dm');
    await sleep(100);
    expect(we.events.some((x) => x.type === 'conversation.new' && x.conversation.id === dm.id)).toBe(false);

    const created = await a.post('/api/channels', { name: 'announce' });
    await we.waitFor((x) => x.type === 'channel.created' && x.channel.name === 'announce');
    expect(created.status).toBe(201);

    await e.post(`/api/channels/${created.json.channel.id}/join`);
    await we.waitFor((x) => x.type === 'conversation.new' && x.conversation.id === created.json.channel.id);

    await b.post(`/api/conversations/${dm.id}/read`, {});
    await wb.waitFor((x) => x.type === 'read' && x.conversationId === dm.id);
  });

  it('ignores malformed client frames without dropping the connection', async () => {
    const wa = await connect(alice);
    wa.ws.send('not json');
    wa.send({ type: 'wat' });
    await wa.waitFor((x) => x.type === 'error' && /Unknown/.test(x.message));
    wa.send({ type: 'ping' });
    await wa.waitFor((x) => x.type === 'pong');
  });
});
