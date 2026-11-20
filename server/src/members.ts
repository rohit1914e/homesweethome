// The six roommates. This is the ONLY source of accounts: seed.ts upserts exactly these rows
// (idempotent, ON CONFLICT (id)), and the schema rejects any other id or slug.
export const MEMBERS = [
  { id: 1, slug: 'rohit', name: 'Rohit', isAdmin: true },
  { id: 2, slug: 'jagan', name: 'Jagan', isAdmin: false },
  { id: 3, slug: 'bharath', name: 'Bharath', isAdmin: false },
  { id: 4, slug: 'surya', name: 'Surya', isAdmin: false },
  { id: 5, slug: 'bazith', name: 'Bazith', isAdmin: false },
  { id: 6, slug: 'dharun', name: 'Dharun', isAdmin: false },
] as const;

export const ADMIN_ID = 1;
export const MEMBER_IDS: number[] = MEMBERS.map((m) => m.id);
