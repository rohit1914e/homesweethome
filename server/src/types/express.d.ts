// requireAuth (server/src/auth.ts) sets req.member from the session cookie.
// Routes must use req.member.id as the actor — never an id from the request body.
export interface AuthMember {
  id: number;
  slug: string;
  name: string;
  isAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      member?: AuthMember;
      sessionTokenHash?: Buffer;
    }
  }
}
