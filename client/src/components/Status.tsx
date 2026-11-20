// Home / College status: a chip anyone can see, and a selector for your own status.
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Member, MemberLocation } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { qk, queryClient, useMe } from '@/lib/queries';

export const LOCATION = {
  home: { emoji: '🏠', label: 'At Home', chip: 'border-leaf/40 bg-leaf-soft text-leaf', on: 'border-leaf bg-leaf-soft text-leaf' },
  college: { emoji: '🎓', label: 'At College', chip: 'border-sky/40 bg-sky-soft text-sky', on: 'border-sky bg-sky-soft text-sky' },
} as const;

export function StatusChip({ location, size = 'sm' }: { location: MemberLocation | null; size?: 'xs' | 'sm' }) {
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs';
  if (!location) return <span className={`inline-flex items-center rounded-full border border-seam ${pad} font-medium text-haze`}>Not set</span>;
  const l = LOCATION[location];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${pad} font-semibold ${l.chip}`}>
      <span aria-hidden>{l.emoji}</span>
      {l.label}
    </span>
  );
}

export function StatusSelector({ className = '' }: { className?: string }) {
  const me = useMe().data;
  const set = useMutation({
    mutationFn: (location: MemberLocation) => api.put<{ member: Member }>('/api/members/me/location', { location }).then((r) => r.member),
    onMutate: (location) => {
      const apply = (m: Member) => (m.id === me?.id ? { ...m, location, locationUpdatedAt: new Date().toISOString() } : m);
      const prev = { me: queryClient.getQueryData<Member>(qk.me), members: queryClient.getQueryData<Member[]>(qk.members) };
      queryClient.setQueryData<Member>(qk.me, (old) => (old ? apply(old) : old));
      queryClient.setQueryData<Member[]>(qk.members, (old) => old?.map(apply));
      return prev;
    },
    onSuccess: (m) => toast.success(`You're ${LOCATION[m.location!].label.toLowerCase()}`),
    onError: (e, _v, prev) => {
      queryClient.setQueryData(qk.me, prev?.me);
      queryClient.setQueryData(qk.members, prev?.members);
      toast.error(errorMessage(e));
    },
  });
  if (!me) return null;
  return (
    <div role="group" aria-label="Your status" className={`grid grid-cols-2 gap-2 ${className}`}>
      {(Object.keys(LOCATION) as MemberLocation[]).map((loc) => {
        const l = LOCATION[loc];
        const on = me.location === loc;
        return (
          <button
            key={loc}
            type="button"
            aria-pressed={on}
            onClick={() => !on && set.mutate(loc)}
            className={`flex items-center justify-center gap-2 rounded-chip border px-3 py-2.5 text-sm font-semibold transition ${on ? l.on : 'border-seam bg-wall text-dusk hover:border-haze hover:text-jasmine'}`}
          >
            <span aria-hidden className="text-base">{l.emoji}</span>
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
