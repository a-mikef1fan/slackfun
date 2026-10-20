import type { ServerEvent } from './types';

export type ConnStatus = 'connecting' | 'open' | 'closed';

interface Handlers {
  onEvent: (e: ServerEvent) => void;
  onStatus: (s: ConnStatus) => void;
  /** Called on every successful (re)connection after the first, so the app can resync missed data. */
  onReconnect: () => void;
}

/** WebSocket wrapper with exponential backoff + jitter reconnect. */
export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private stopped = false;
  private everOpened = false;

  constructor(private token: string, private h: Handlers) {
    this.connect();
    window.addEventListener('online', this.nudge);
    document.addEventListener('visibilitychange', this.nudge);
  }

  private nudge = () => {
    // If we're waiting on a backoff timer and the browser says things look good, retry right away.
    if (this.stopped || this.ws) return;
    if (document.visibilityState === 'visible' && navigator.onLine) this.connectNow();
  };

  private connectNow() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.connect();
  }

  private connect() {
    if (this.stopped) return;
    this.h.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.h.onStatus('open');
      if (this.everOpened) this.h.onReconnect();
      this.everOpened = true;
    };
    ws.onmessage = (ev) => {
      try {
        this.h.onEvent(JSON.parse(ev.data));
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.h.onStatus('closed');
      const delay = Math.min(15000, 500 * 2 ** this.attempt++) * (0.75 + Math.random() * 0.5);
      this.timer = window.setTimeout(() => {
        this.timer = null;
        this.connect();
      }, delay);
    };
    ws.onerror = () => ws.close();
  }

  send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    window.removeEventListener('online', this.nudge);
    document.removeEventListener('visibilitychange', this.nudge);
    this.ws?.close();
  }
}
