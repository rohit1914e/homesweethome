// The signature motif: all six faces, always in the same order, each ringed by its vote.
import type { Menu, VoteChoice } from '@shared/types';
import { Avatar, type AvatarRing } from '@/components/Avatar';
import { useMembers } from '@/lib/queries';

const WORD: Record<VoteChoice | 'pending', string> = {
  want: 'Wants it',
  dont_want: 'Doesn’t',
  pending: 'Not yet',
};
const WORD_TONE: Record<VoteChoice | 'pending', string> = {
  want: 'text-leaf',
  dont_want: 'text-chili',
  pending: 'text-haze',
};

export function HouseholdStrip({
  menu,
  size = 'md',
  showWords = true,
  myId,
}: {
  menu: Pick<Menu, 'votes' | 'title'>;
  size?: 'xs' | 'sm' | 'md';
  /** Name + response under each face. Off = compact row of faces only. */
  showWords?: boolean;
  myId?: number;
}) {
  const { members } = useMembers();
  const choiceOf = new Map(menu.votes.map((v) => [v.memberId, v.choice]));
  const label = `Responses to ${menu.title}`;

  if (!showWords) {
    return (
      <ul aria-label={label} className="flex items-center gap-2">
        {members.map((m) => {
          const c = choiceOf.get(m.id) ?? 'pending';
          return (
            <li key={m.id} title={`${m.name}: ${WORD[c].toLowerCase()}`}>
              <Avatar member={m} size={size} ring={c as AvatarRing} />
              <span className="sr-only">{WORD[c]}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul aria-label={label} className="grid grid-cols-6 gap-1 sm:gap-3">
      {members.map((m) => {
        const c = choiceOf.get(m.id) ?? 'pending';
        const isMe = m.id === myId;
        return (
          <li key={m.id} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
            <span aria-hidden>
              <Avatar member={m} size={size} ring={c as AvatarRing} />
            </span>
            <span className={`w-full truncate text-xs font-semibold sm:text-sm ${isMe ? 'text-jasmine' : 'text-dusk'}`}>
              {isMe ? 'You' : m.name}
            </span>
            <span className={`-mt-1 w-full truncate text-[11px] sm:text-xs ${WORD_TONE[c]}`}>{WORD[c]}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Three counts, in words. */
export function Tally({ menu, className = '' }: { menu: Pick<Menu, 'tally'>; className?: string }) {
  const { want, dontWant, pending } = menu.tally;
  return (
    <p className={`flex flex-wrap gap-x-4 gap-y-1 text-sm ${className}`}>
      <span>
        <strong className="text-base font-bold text-leaf tabular-nums">{want}</strong> <span className="text-dusk">want it</span>
      </span>
      <span>
        <strong className="text-base font-bold text-chili tabular-nums">{dontWant}</strong>{' '}
        <span className="text-dusk">don’t want it</span>
      </span>
      <span>
        <strong className="text-base font-bold text-jasmine tabular-nums">{pending}</strong>{' '}
        <span className="text-dusk">not responded yet</span>
      </span>
    </p>
  );
}
