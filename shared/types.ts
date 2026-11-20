// Shared API + socket contract between server and client.
// Dates are 'YYYY-MM-DD' strings in the room timezone (Asia/Kolkata).
// Timestamps are ISO-8601 strings (UTC).

export type MemberId = 1 | 2 | 3 | 4 | 5 | 6;

/** Shown on the login screen (unauthenticated). */
export interface PublicMember {
  id: number;
  slug: string;
  name: string;
  avatarUrl: string | null;
  hasPin: boolean;
}

export interface Member extends PublicMember {
  /** Used only to decide what controls to show. Never render "Admin" as a label. */
  isAdmin: boolean;
  bio: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface Meta {
  today: string;
  timezone: string;
  serverTime: string;
  bookingWindow: { start: string; end: string; days: number };
}

// ---- Cooking ---------------------------------------------------------------
export type VoteChoice = 'want' | 'dont_want';

export interface Vote {
  memberId: number;
  choice: VoteChoice;
  updatedAt: string;
}

export interface Menu {
  id: number;
  menuDate: string;
  title: string;
  description: string;
  imageUrl: string | null;
  status: 'open' | 'closed';
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  votes: Vote[];
  tally: { want: number; dontWant: number; pending: number };
  myVote: VoteChoice | null;
}

export interface MenuInput {
  title: string;
  description?: string;
  menuDate: string;
  /** data: URL (jpeg/png/webp, ≤2 MB decoded). On PATCH: null removes, undefined keeps. */
  image?: string | null;
}

// ---- Washing machine -------------------------------------------------------
export interface Booking {
  id: number;
  date: string;
  memberId: number;
  bookedBy: number;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: number | null;
}

// ---- Chat ------------------------------------------------------------------
export interface ChatMessage {
  id: number;
  memberId: number;
  body: string;
  createdAt: string;
  clientId: string | null;
}

// ---- Notifications ---------------------------------------------------------
export type NotificationKind =
  | 'menu_published'
  | 'menu_updated'
  | 'menu_closed'
  | 'vote_cast'
  | 'booking_created'
  | 'booking_cancelled'
  | 'chat_message';

export interface AppNotification {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  actorId: number | null;
  count: number;
  createdAt: string;
  readAt: string | null;
}

// ---- Socket.IO events ------------------------------------------------------
export type MenuAction = 'created' | 'updated' | 'deleted' | 'closed' | 'reopened' | 'voted';

export interface ServerToClientEvents {
  'presence:state': (p: { online: number[] }) => void;
  'presence:update': (p: { memberId: number; online: boolean; lastSeenAt: string | null }) => void;
  'menu:changed': (p: { menuId: number; action: MenuAction }) => void;
  'booking:changed': (p: { bookingId: number; date: string; action: 'created' | 'cancelled' }) => void;
  'chat:message': (m: ChatMessage) => void;
  'chat:typing': (p: { memberId: number; typing: boolean }) => void;
  'notification:new': (n: AppNotification) => void;
  'session:revoked': () => void;
}

export interface ClientToServerEvents {
  'chat:typing': (p: { typing: boolean }) => void;
}
