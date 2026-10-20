import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, mkChannel, signup, type Client, type TestUser } from './helpers.js';

describe('reactions', () => {
  let app: FastifyInstance;
  let alice: TestUser, bob: TestUser, eve: TestUser;
  let a: Client, b: Client, e: Client;
  let chan: number;
  let msg: number;

  beforeAll(async () => {
    app = await makeApp();
    alice = await signup(app, 'Alice');
    bob = await signup(app, 'Bob');
    eve = await signup(app, 'Eve');
    a = client(app, alice);
    b = client(app, bob);
    e = client(app, eve);
    chan = await mkChannel(a, 'reactions');
    await b.post(`/api/channels/${chan}/join`);
    msg = (await a.post(`/api/conversations/${chan}/messages`, { body: 'react to me' })).json.message.id;
  });
  afterAll(() => app.close());

  it('toggles a reaction on and off', async () => {
    const on = await a.post(`/api/messages/${msg}/reactions`, { emoji: '👍' });
    expect(on.status).toBe(200);
    expect(on.json.added).toBe(true);
    expect(on.json.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [alice.id] }]);
    const off = await a.post(`/api/messages/${msg}/reactions`, { emoji: '👍' });
    expect(off.json.added).toBe(false);
    expect(off.json.reactions).toEqual([]);
  });

  it('groups counts and records who reacted', async () => {
    await a.post(`/api/messages/${msg}/reactions`, { emoji: '🎉' });
    await b.post(`/api/messages/${msg}/reactions`, { emoji: '🎉' });
    await b.post(`/api/messages/${msg}/reactions`, { emoji: '❤️' });
    const list = (await a.get(`/api/conversations/${chan}/messages`)).json.messages;
    const reactions = list.find((m: any) => m.id === msg).reactions;
    expect(reactions).toEqual([
      { emoji: '🎉', count: 2, userIds: [alice.id, bob.id] },
      { emoji: '❤️', count: 1, userIds: [bob.id] },
    ]);
  });

  it('supports explicit removal via DELETE (idempotent)', async () => {
    const r = await b.del(`/api/messages/${msg}/reactions/${encodeURIComponent('🎉')}`);
    expect(r.status).toBe(200);
    expect(r.json.removed).toBe(true);
    expect(r.json.reactions.find((x: any) => x.emoji === '🎉')).toEqual({ emoji: '🎉', count: 1, userIds: [alice.id] });
    const again = await b.del(`/api/messages/${msg}/reactions/${encodeURIComponent('🎉')}`);
    expect(again.json.removed).toBe(false);
  });

  it('works on thread replies too', async () => {
    const reply = (await b.post(`/api/conversations/${chan}/messages`, { body: 'a reply', parentId: msg })).json.message;
    const r = await a.post(`/api/messages/${reply.id}/reactions`, { emoji: '😂' });
    expect(r.json.added).toBe(true);
    const thread = (await a.get(`/api/messages/${msg}/thread`)).json;
    expect(thread.replies[0].reactions).toEqual([{ emoji: '😂', count: 1, userIds: [alice.id] }]);
  });

  it('rejects non-emoji input and non-members', async () => {
    for (const emoji of ['', 'a', 'hello', '<b>', '1', 'x'.repeat(33), '👍 ']) {
      expect((await a.post(`/api/messages/${msg}/reactions`, { emoji })).status, emoji).toBe(400);
    }
    expect((await e.post(`/api/messages/${msg}/reactions`, { emoji: '👍' })).status).toBe(403);
    expect((await e.del(`/api/messages/${msg}/reactions/${encodeURIComponent('🎉')}`)).status).toBe(403);
    expect((await a.post('/api/messages/99999/reactions', { emoji: '👍' })).status).toBe(404);
  });

  it('clears reactions when the message is deleted', async () => {
    const m = (await a.post(`/api/conversations/${chan}/messages`, { body: 'short lived' })).json.message;
    await b.post(`/api/messages/${m.id}/reactions`, { emoji: '🔥' });
    await a.del(`/api/messages/${m.id}`);
    expect((await b.post(`/api/messages/${m.id}/reactions`, { emoji: '🔥' })).status).toBe(400);
    const got = (await a.get(`/api/conversations/${chan}/messages`)).json.messages.find((x: any) => x.id === m.id);
    expect(got.reactions).toEqual([]);
  });
});
