// Smoke check against a running, freshly seeded server (BASE=http://localhost:3000): REST flow + two-client WebSocket delivery.
// Usage: npm start (in another shell), then: node scripts/smoke.mjs
import WebSocket from 'ws';
const BASE = process.env.BASE ?? 'http://localhost:3000';
const WS = BASE.replace('http', 'ws');
const j = async (tok, method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const demo = (await j(null, 'GET', '/api/demo-users')).j.users;
const maya = (await j(null, 'POST', '/api/users', { name: 'Maya Okafor' })).j;
const theo = (await j(null, 'POST', '/api/users', { name: 'Theo Lindqvist' })).j;
ok(demo.length === 4 && maya.token === demo.find(u => u.name === 'Maya Okafor').id, 'demo users + login returns existing user');
const convs = (await j(maya.token, 'GET', '/api/conversations')).j.conversations;
const general = convs.find(c => c.name === 'general');
ok(convs.length >= 5 && general.unread === 0, `maya has ${convs.length} conversations incl. #general`);

const open = (tok) => new Promise((res) => { const ws = new WebSocket(`${WS}/ws?token=${tok}`); ws.events = []; ws.on('message', d => ws.events.push(JSON.parse(d))); ws.on('open', () => res(ws)); });
const wait = async (ws, pred, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { const e = ws.events.find(pred); if (e) return e; await new Promise(r => setTimeout(r, 20)); } return null; };
const wm = await open(maya.token), wt = await open(theo.token);
const sent = (await j(maya.token, 'POST', `/api/conversations/${general.id}/messages`, { body: 'smoke: hello Theo' })).j.message;
const got = await wait(wt, e => e.type === 'message.new' && e.message.id === sent.id);
ok(!!got && got.message.body === 'smoke: hello Theo', 'Theo received message.new in realtime');
await j(theo.token, 'POST', `/api/messages/${sent.id}/reactions`, { emoji: '🎉' });
ok(!!(await wait(wm, e => e.type === 'reaction.updated' && e.messageId === sent.id)), 'Maya received reaction.updated');
await j(theo.token, 'POST', `/api/conversations/${general.id}/messages`, { body: 'smoke reply', parentId: sent.id });
ok(!!(await wait(wm, e => e.type === 'thread.updated' && e.parentId === sent.id && e.replyCount === 1)), 'Maya received thread.updated (replyCount=1)');
wt.send(JSON.stringify({ type: 'typing', conversationId: general.id }));
ok(!!(await wait(wm, e => e.type === 'typing' && e.userId === theo.token)), 'typing indicator relayed');
const s = (await j(maya.token, 'GET', '/api/search?q=' + encodeURIComponent('smoke in:general from:theo'))).j;
ok(s.results.length === 1 && s.results[0].message.parentId === sent.id, 'FTS search with in:/from: filters finds the reply');
wt.close();
ok(!!(await wait(wm, e => e.type === 'presence' && e.userId === theo.token && e.online === false)), 'presence offline broadcast');
wm.close();
const nonmember = (await j(maya.token, 'GET', '/api/conversations/' + (convs.length + 50) + '/messages')).s;
ok(nonmember === 404, 'unknown conversation -> 404');
