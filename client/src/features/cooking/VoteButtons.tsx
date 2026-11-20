import { Check, Lock, X } from 'lucide-react';
import type { Menu, VoteChoice } from '@shared/types';
import { useMe } from '@/lib/queries';
import { useVote } from './api';

const OPTIONS: { choice: VoteChoice; label: string; icon: typeof Check; on: string; off: string }[] = [
  {
    choice: 'want',
    label: 'OK, I want this',
    icon: Check,
    on: 'border-leaf bg-leaf text-night',
    off: 'border-seam bg-wall text-jasmine hover:border-leaf hover:bg-leaf-soft',
  },
  {
    choice: 'dont_want',
    label: 'I don’t want this',
    icon: X,
    on: 'border-chili bg-chili text-night',
    off: 'border-seam bg-wall text-jasmine hover:border-chili hover:bg-chili-soft',
  },
];

export function VoteButtons({ menu, size = 'lg' }: { menu: Menu; size?: 'md' | 'lg' }) {
  const me = useMe().data;
  const vote = useVote(me?.id);
  const closed = menu.status === 'closed';
  const pendingChoice = vote.isPending && vote.variables?.menuId === menu.id ? vote.variables.choice : null;
  const current = pendingChoice ?? menu.myVote;
  const height = size === 'lg' ? 'min-h-14 text-base' : 'min-h-11 text-sm';

  return (
    <div>
      <div role="group" aria-label={`Your vote on ${menu.title}`} className="grid grid-cols-2 gap-2 sm:gap-3">
        {OPTIONS.map(({ choice, label, icon: Icon, on, off }) => {
          const selected = current === choice;
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={selected}
              disabled={closed || !me}
              onClick={() => {
                if (!selected) vote.mutate({ menuId: menu.id, choice });
              }}
              className={`inline-flex items-center justify-center gap-2 rounded-chip border-2 px-3 py-2 font-semibold leading-tight transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.97] disabled:cursor-not-allowed ${height} ${
                selected ? on : off
              } ${closed && !selected ? 'opacity-50' : ''}`}
            >
              <Icon className={`size-5 shrink-0 transition-transform duration-200 ${selected ? 'scale-110' : 'opacity-70'}`} aria-hidden />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {closed && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-dusk">
          <Lock className="size-4" aria-hidden />
          {menu.myVote
            ? 'Voting is closed. Your answer is locked in.'
            : 'Voting is closed. Rohit has stopped taking answers for this menu.'}
        </p>
      )}
      {!closed && menu.myVote && (
        <p className="mt-2 text-sm text-haze">You can change your answer until Rohit closes voting.</p>
      )}
    </div>
  );
}
