import { Portrait } from '@/components/Portrait';
import { PageHeader, Skeleton } from '@/components/ui';
import { lastSeenPhrase } from '@/components/when';
import { usePresenceSync } from '@/features/chat/chatStore';
import { useMe, useMembers } from '@/lib/queries';

export default function MembersPage() {
  usePresenceSync();
  const { members, isPending } = useMembers();
  const me = useMe().data;
  return (
    <div>
      <PageHeader title="Members" description="The six of us." />
      {isPending ? (
        <Skeleton className="h-96" />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-4 rounded-tile border border-seam bg-room p-4">
              <div className="relative">
                <Portrait member={m} className="size-24 rounded-full" />
                <span className={`absolute right-1 bottom-1 size-4 rounded-full border-2 border-room ${m.online ? 'bg-leaf' : 'bg-ash'}`} aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xl font-bold">
                  {m.name}
                  {m.id === me?.id && <span className="ml-2 text-sm font-medium text-dusk">(you)</span>}
                </p>
                <p className={`text-sm ${m.online ? 'text-leaf' : 'text-dusk'}`}>{m.online ? 'Online now' : lastSeenPhrase(m.lastSeenAt)}</p>
                {m.bio && <p className="mt-1.5 line-clamp-3 text-sm text-dusk">{m.bio}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
