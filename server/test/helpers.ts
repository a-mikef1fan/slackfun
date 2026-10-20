import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';

export async function makeApp(seed = false): Promise<FastifyInstance> {
  const app = await buildApp({ seed });
  await app.ready();
  return app;
}

export interface TestUser {
  id: string;
  name: string;
  token: string;
}

export async function signup(app: FastifyInstance, name: string): Promise<TestUser> {
  const res = await app.inject({ method: 'POST', url: '/api/users', payload: { name } });
  const json = res.json();
  return { id: json.user.id, name: json.user.name, token: json.token };
}

export function client(app: FastifyInstance, user: TestUser) {
  const headers = { authorization: `Bearer ${user.token}` };
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, headers, payload: payload as any });
    let json: any = null;
    try {
      json = res.json();
    } catch {
      /* empty body */
    }
    return { status: res.statusCode, json };
  };
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body: unknown = {}) => call('POST', url, body),
    patch: (url: string, body: unknown) => call('PATCH', url, body),
    del: (url: string) => call('DELETE', url),
  };
}

export type Client = ReturnType<typeof client>;

/** Create a channel and return its id. */
export async function mkChannel(c: Client, name: string): Promise<number> {
  const r = await c.post('/api/channels', { name });
  return r.json.channel.id;
}

export class WsClient {
  events: any[] = [];
  private waiters: { pred: (e: any) => boolean; resolve: (e: any) => void; timer: NodeJS.Timeout }[] = [];
  readonly ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const ev = JSON.parse(raw.toString());
      this.events.push(ev);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(ev)) {
          clearTimeout(w.timer);
          w.resolve(ev);
          return false;
        }
        return true;
      });
    });
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  /** Resolve with the first event (past or future) matching the predicate. */
  waitFor(pred: (e: any) => boolean, timeoutMs = 3000): Promise<any> {
    const past = this.events.find(pred);
    if (past) return Promise.resolve(past);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for event')), timeoutMs);
      this.waiters.push({ pred, resolve, timer });
    });
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

export async function connectWs(baseUrl: string, token: string): Promise<WsClient> {
  const c = new WsClient(`${baseUrl.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`);
  await c.opened();
  return c;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
