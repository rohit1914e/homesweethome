// A member in a doorway: the arched portrait used on the login screen and the members page.
import { useState } from 'react';
import type { PublicMember } from '@shared/types';

export function Portrait({
  member,
  className = '',
  eager = false,
}: {
  member: Pick<PublicMember, 'name' | 'avatarUrl'>;
  className?: string;
  eager?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const showImg = member.avatarUrl && !broken;
  return (
    <span className={`relative block aspect-[4/5] w-full overflow-hidden door bg-wall ${className}`}>
      {showImg ? (
        <img
          src={member.avatarUrl!}
          alt=""
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover object-[50%_22%]"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-wall text-[clamp(3rem,10vw,5.5rem)] font-bold text-dusk type-display"
        >
          {member.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      {/* inner frame line, like a door jamb */}
      <span aria-hidden className="pointer-events-none absolute inset-0 door ring-1 ring-jasmine/10 ring-inset" />
    </span>
  );
}
