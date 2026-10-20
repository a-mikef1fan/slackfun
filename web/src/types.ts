export interface User {
  id: string;
  name: string;
  handle: string;
  color: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface Message {
  id: number;
  conversationId: number;
  userId: string;
  parentId: number | null;
  body: string;
  createdAt: number;
  editedAt: number | null;
  deleted: boolean;
  replyCount: number;
  lastReplyAt: number | null;
  lastReplyUserId: string | null;
  reactions: Reaction[];
}

export interface Conversation {
  id: number;
  kind: 'channel' | 'dm';
  name: string | null;
  topic: string;
  createdAt: number;
  memberIds: string[];
  unread: number;
  lastMessage: { id: number; userId: string; body: string; createdAt: number } | null;
  lastActivityAt: number;
}

export interface ChannelListing {
  id: number;
  name: string;
  topic: string;
  memberCount: number;
  joined: boolean;
  createdAt: number;
}

export interface SearchResult {
  message: Message;
  snippet: string;
  conversation: { id: number; kind: 'channel' | 'dm'; name: string | null; memberIds: string[] };
}

export type ServerEvent =
  | { type: 'hello'; userId: string; online: string[] }
  | { type: 'message.new'; message: Message }
  | { type: 'message.updated'; message: Message }
  | { type: 'message.deleted'; message: Message }
  | { type: 'thread.updated'; conversationId: number; parentId: number; replyCount: number; lastReplyAt: number | null; lastReplyUserId: string | null }
  | { type: 'reaction.updated'; conversationId: number; messageId: number; parentId: number | null; reactions: Reaction[] }
  | { type: 'typing'; conversationId: number; parentId: number | null; userId: string }
  | { type: 'presence'; userId: string; online: boolean }
  | { type: 'conversation.new'; conversation: Conversation }
  | { type: 'channel.created'; channel: ChannelListing }
  | { type: 'member.joined'; conversationId: number; userId: string }
  | { type: 'member.left'; conversationId: number; userId: string }
  | { type: 'read'; conversationId: number; lastReadId: number }
  | { type: 'error'; message: string }
  | { type: 'pong' };

export type RailTab = 'home' | 'dms' | 'spaces';
