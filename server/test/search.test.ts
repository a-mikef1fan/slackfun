import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, mkChannel, signup, type Client, type TestUser } from './helpers.js';
import { parseSearchQuery } from '../src/search.js';

describe('search', () => {
  let app: FastifyInstance;
  let alice: TestUser, bob: TestUser, eve: TestUser;
  let a: Client, b: Client, e: Client;
  let eng: number, ops: number, dm: number;
  const search = async (c: Client, q: string) => {
    const r = await c.get(`/api/search?q=${encodeURIComponent(q)}`);
    return r;
  };
  const bodies = (r: any) => r.json.results.map((x: any) => x.message.body);

  beforeAll(async () => {
    app = await makeApp();
    alice = await signup(app, 'Alice Adams');
    bob = await signup(app, 'Bob Brown');
    eve = await signup(app, 'Eve Evans');
    a = client(app, alice);
    b = client(app, bob);
    e = client(app, eve);
    eng = await mkChannel(a, 'engineering');
    ops = await mkChannel(a, 'ops');
    await b.post(`/api/channels/${eng}/join`);
    await b.post(`/api/channels/${ops}/join`);
    dm = (await a.post('/api/dms', { userIds: [bob.id] })).json.conversation.id;

    await a.post(`/api/conversations/${eng}/messages`, { body: 'Deploying the new gateway tonight' });
    await b.post(`/api/conversations/${eng}/messages`, { body: 'Deployment checklist is ready' });
    await a.post(`/api/conversations/${ops}/messages`, { body: 'Pager rotation: deploy freeze on Friday' });
    await a.post(`/api/conversations/${dm}/messages`, { body: 'private deploy gossip' });
    const root = (await a.post(`/api/conversations/${eng}/messages`, { body: 'Thread root about databases' })).json.message;
    await b.post(`/api/conversations/${eng}/messages`, { body: 'reply mentioning sqlite fts5', parentId: root.id });
  });
  afterAll(() => app.close());

  it('finds messages with prefix matching and returns highlighted snippets', async () => {
    const r = await search(a, 'deploy');
    expect(r.status).toBe(200);
    expect(bodies(r).sort()).toEqual(
      ['Deploying the new gateway tonight', 'Deployment checklist is ready', 'Pager rotation: deploy freeze on Friday', 'private deploy gossip'].sort()
    );
    const hit = r.json.results.find((x: any) => x.message.body.startsWith('Pager'));
    expect(hit.snippet).toContain('\u0001deploy\u0002');
    expect(hit.conversation).toMatchObject({ id: ops, kind: 'channel', name: 'ops' });
  });

  it('only returns messages from conversations the user belongs to', async () => {
    const forEve = await search(e, 'deploy');
    expect(forEve.json.results).toEqual([]);
    // Bob is in eng+ops and the DM
    expect(bodies(await search(b, 'gossip'))).toEqual(['private deploy gossip']);
    // Alice leaves ops: those messages vanish from her results
    await a.post(`/api/channels/${ops}/leave`);
    expect(bodies(await search(a, 'freeze'))).toEqual([]);
    await a.post(`/api/channels/${ops}/join`);
    expect(bodies(await search(a, 'freeze'))).toEqual(['Pager rotation: deploy freeze on Friday']);
  });

  it('supports in: and from: filters, alone or combined with text', async () => {
    expect(bodies(await search(a, 'deploy in:ops'))).toEqual(['Pager rotation: deploy freeze on Friday']);
    expect(bodies(await search(a, 'deploy in:#engineering')).sort()).toEqual(
      ['Deploying the new gateway tonight', 'Deployment checklist is ready'].sort()
    );
    expect(bodies(await search(a, 'deploy from:bob-brown'))).toEqual(['Deployment checklist is ready']);
    expect(bodies(await search(a, 'deploy from:"Bob Brown"'))).toEqual(['Deployment checklist is ready']);
    expect(bodies(await search(a, 'deploy from:bob-brown in:ops'))).toEqual([]);
    expect(bodies(await search(a, 'from:bob-brown in:engineering')).sort()).toEqual(
      ['Deployment checklist is ready', 'reply mentioning sqlite fts5'].sort()
    );
    expect(bodies(await search(a, 'gossip in:dm'))).toEqual(['private deploy gossip']);
    expect((await search(a, 'deploy in:nonexistent')).json.results).toEqual([]);
  });

  it('includes thread replies and reports their parent for click-to-jump', async () => {
    const r = await search(a, 'sqlite');
    expect(r.json.results).toHaveLength(1);
    expect(r.json.results[0].message.parentId).toBeTypeOf('number');
    expect(r.json.results[0].message.conversationId).toBe(eng);
  });

  it('keeps the index in sync with edits and deletes', async () => {
    const m = (await b.post(`/api/conversations/${eng}/messages`, { body: 'zebra crossing ahead' })).json.message;
    expect(bodies(await search(a, 'zebra'))).toHaveLength(1);
    await b.patch(`/api/messages/${m.id}`, { body: 'giraffe crossing ahead' });
    expect(bodies(await search(a, 'zebra'))).toHaveLength(0);
    expect(bodies(await search(a, 'giraffe'))).toEqual(['giraffe crossing ahead']);
    await b.del(`/api/messages/${m.id}`);
    expect(bodies(await search(a, 'giraffe'))).toHaveLength(0);
  });

  it('treats FTS syntax and SQL metacharacters as literal text', async () => {
    for (const q of ['"', 'deploy AND', 'NEAR(', 'deploy*', '(((', "'; DROP TABLE messages;--", 'a OR b', 'col:val', '^deploy', '-deploy', '{', '\\']) {
      const r = await search(a, q);
      expect([200, 400], q).toContain(r.status);
    }
    expect((await search(a, 'x')).status).toBe(200);
    // table still intact
    expect(bodies(await search(a, 'deploy')).length).toBeGreaterThan(0);
  });

  it('validates the query', async () => {
    expect((await a.get('/api/search')).status).toBe(400);
    expect((await a.get('/api/search?q=')).status).toBe(400);
    expect((await search(a, '   ')).status).toBe(400);
    expect((await search(a, '!!!')).status).toBe(400);
    expect((await a.get(`/api/search?q=x&limit=1000`)).status).toBe(400);
    const limited = await a.get('/api/search?q=deploy&limit=2');
    expect(limited.json.results).toHaveLength(2);
  });

  it('parses queries into filters and quoted terms', () => {
    expect(parseSearchQuery('hello world in:general from:maya')).toMatchObject({
      terms: ['hello', 'world'],
      inChannels: ['general'],
      from: ['maya'],
      ftsQuery: '"hello" "world"*',
    });
    expect(parseSearchQuery('"exact phrase" x"y').terms).toEqual(['exact', 'phrase', 'x', 'y']);
    expect(parseSearchQuery('in:#dev from:@sam').inChannels).toEqual(['dev']);
    expect(parseSearchQuery('in:#dev from:@sam').ftsQuery).toBeNull();
  });
});
