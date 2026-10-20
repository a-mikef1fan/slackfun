import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp, signup } from './helpers.js';
import { buildApp } from '../src/app.js';

describe('auth-lite and users', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(() => app.close());

  it('creates a user and returns the id as the token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/users', payload: { name: '  Ada   Lovelace ' } });
    expect(res.statusCode).toBe(201);
    const { user, token } = res.json();
    expect(user.name).toBe('Ada Lovelace');
    expect(user.handle).toBe('ada-lovelace');
    expect(token).toBe(user.id);
  });

  it('returns the existing user when the name is reused (case-insensitive)', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/users', payload: { name: 'Grace Hopper' } });
    const b = await app.inject({ method: 'POST', url: '/api/users', payload: { name: 'grace hopper' } });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json().user.id).toBe(a.json().user.id);
  });

  it('rejects invalid names', async () => {
    for (const payload of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(41) }, { name: '<b>hi</b>' }, { name: { a: 1 } }, { name: ['x', 'y'] }]) {
      const res = await app.inject({ method: 'POST', url: '/api/users', payload: payload as any });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('requires a valid token on authenticated routes', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/channels' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/search?q=x' })).statusCode).toBe(401);
    const u = await signup(app, 'Token User');
    const ok = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${u.token}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.id).toBe(u.id);
    const viaHeader = await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-user-id': u.id } });
    expect(viaHeader.statusCode).toBe(200);
  });

  it('lists users with presence flag', async () => {
    const u = await signup(app, 'Lister');
    const res = await client(app, u).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.json.users.some((x: any) => x.id === u.id && x.online === false)).toBe(true);
  });

  it('auto-joins new users to default channels and seeds demo data', async () => {
    const seeded = await buildApp({ seed: true });
    await seeded.ready();
    const demo = (await seeded.inject({ method: 'GET', url: '/api/demo-users' })).json().users;
    expect(demo).toHaveLength(4);
    const newbie = await signup(seeded, 'Newbie');
    const c = client(seeded, newbie);
    const convs = (await c.get('/api/conversations')).json.conversations;
    expect(convs.map((x: any) => x.name).sort()).toEqual(['general', 'random']);
    const channels = (await c.get('/api/channels')).json.channels;
    expect(channels.map((x: any) => x.name)).toEqual(['engineering', 'general', 'random']);
    const eng = channels.find((x: any) => x.name === 'engineering');
    expect(eng.joined).toBe(false);
    await seeded.close();
  });
});
