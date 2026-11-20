// The household motif: a member's face, optionally ringed by state (vote) and a presence dot.
// Falls back to initials when no photo has been provided — never a fake picture.
import { useState } from 'react';
import type { PublicMember } from '@shared/types';

export type AvatarRing = 'want' | 'dont_want' | 'pending' | 'none';

const SIZES = { xs: 'size-7 text-[11px]', sm: 'size-9 text-xs', md: 'size-12 text-sm', lg: 'size-16 text-lg', xl: 'size-28 text-3xl' } as const;

const RINGS: Record<AvatarRing, string> = {
  want: 'ring-2 ring-leaf ring-offset-2 ring-offset-room',
  dont_want: 'ring-2 ring-chili ring-offset-2 ring-offset-room',
  pending: 'outline-2 outline-dashed outline-haze outline-offset-2',
  none: '',
};

export function Avatar({
  member,
  size = 'md',
  ring = 'none',
  online,
  className = '',
}: {
  member: Pick<PublicMember, 'name' | 'avatarUrl'> | undefined;
  size?: keyof typeof SIZES;
  ring?: AvatarRing;
  /** undefined = don't show presence */
  online?: boolean;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const name = member?.name ?? '?';
  const showImg = member?.avatarUrl && !broken;
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span
        className={`${SIZES[size]} ${RINGS[ring]} inline-flex items-center justify-center overflow-hidden rounded-full bg-wall font-semibold text-dusk transition-[box-shadow,outline-color] duration-300`}
      >
        {showImg ? (
          <img src={member!.avatarUrl!} alt="" className="size-full object-cover" loading="lazy" onError={() => setBroken(true)} />
        ) : (
          <span aria-hidden>{name.slice(0, 1).toUpperCase()}</span>
        )}
      </span>
      {online !== undefined && (
        <span
          className={`absolute right-0 bottom-0 size-3 rounded-full border-2 border-room ${online ? 'bg-leaf' : 'bg-ash'}`}
          aria-label={online ? `${name} is online` : `${name} is offline`}
        />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
