import type { WebSocket } from 'ws';
import type { Store } from './store.js';
import type { ServerEvent } from './types.js';

/** Tracks connected sockets per user and fans events out to conversation members. */
export class Hub {
  private sockets = new Map<string, Set<WebSocket>>();

  constructor(private store: Store) {}

  /** Returns true if this is the user's first connection (they just came online). */
  add(userId: string, socket: WebSocket): boolean {
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(socket);
    return set.size === 1;
  }

  /** Returns true if that was the user's last connection (they just went offline). */
  remove(userId: string, socket: WebSocket): boolean {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socket);
    if (set.size === 0) {
      this.sockets.delete(userId);
      return true;
    }
    return false;
  }

  online(): string[] {
    return [...this.sockets.keys()];
  }

  allSockets(): WebSocket[] {
    return [...this.sockets.values()].flatMap((s) => [...s]);
  }

  private send(socket: WebSocket, payload: string): void {
    if (socket.readyState === 1 /* OPEN */) socket.send(payload);
  }

  toSocket(socket: WebSocket, event: ServerEvent): void {
    this.send(socket, JSON.stringify(event));
  }

  toUser(userId: string, event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const s of this.sockets.get(userId) ?? []) this.send(s, payload);
  }

  toUsers(userIds: string[], event: ServerEvent): void {
    for (const id of userIds) this.toUser(id, event);
  }

  /** Send to every current member of a conversation (membership is read at send time). */
  toConversation(conversationId: number, event: ServerEvent, exceptUserId?: string): void {
    const payload = JSON.stringify(event);
    for (const uid of this.store.memberIds(conversationId)) {
      if (uid === exceptUserId) continue;
      for (const s of this.sockets.get(uid) ?? []) this.send(s, payload);
    }
  }

  toAll(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const set of this.sockets.values()) for (const s of set) this.send(s, payload);
  }
}
