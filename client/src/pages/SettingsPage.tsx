import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, KeyRound, LogOut, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from '@/components/Avatar';
import { CleanupCard } from '@/features/settings/CleanupCard';
import { PhotoPicker, isUploaded } from '@/features/settings/PhotoPicker';
import { PlacesCard } from '@/features/settings/PlacesCard';
import { Button, Card, ConfirmDialog, PageHeader, TextArea, TextField } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useSignOut } from '@/lib/auth';
import { qk, queryClient, useMe, useMembers } from '@/lib/queries';

export default function SettingsPage() {
  const me = useMe().data;
  const signOut = useSignOut();
  if (!me) return null;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" actions={<Button variant="secondary" icon={<LogOut className="size-4" aria-hidden />} onClick={() => void signOut()}>Sign out</Button>} />
      <ProfileCard />
      <PinCard />
      {me.isAdmin && <HouseSettings />}
      {me.isAdmin && <PlacesCard />}
      {me.isAdmin && <CleanupCard />}
    </div>
  );
}

function ProfileCard() {
  const me = useMe().data!;
  const [bio, setBio] = useState(me.bio);
  useEffect(() => setBio(me.bio), [me.bio]);
  const save = useMutation({
    mutationFn: () => api.patch('/api/members/me', { bio }),
    onSuccess: () => {
      toast.success('Saved your profile');
      void queryClient.invalidateQueries({ queryKey: qk.me });
      void queryClient.invalidateQueries({ queryKey: qk.members });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <Avatar member={me} size="lg" />
        <div>
          <h2 className="text-xl font-bold">{me.name}</h2>
          <div className="mt-2"><PhotoPicker name={me.name} hasUpload={isUploaded(me.avatarUrl)} /></div>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="flex flex-col gap-3">
        <TextArea label="About you" maxLength={280} value={bio} onChange={(e) => setBio(e.target.value)} hint={`${bio.length}/280 — shown on the Members page.`} />
        <Button type="submit" className="self-start" loading={save.isPending} disabled={bio === me.bio}>Save profile</Button>
      </form>
    </Card>
  );
}

function PinCard() {
  const me = useMe().data!;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const update = useMutation({
    mutationFn: (newPin: string | null) => api.put('/api/members/me/pin', { currentPin: me.hasPin ? current : undefined, newPin }),
    onSuccess: (_d, newPin) => {
      toast.success(newPin ? 'Saved your PIN' : 'Removed your PIN');
      setCurrent('');
      setNext('');
      void queryClient.invalidateQueries({ queryKey: qk.me });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);
  return (
    <Card>
      <h2 className="flex items-center gap-2 text-xl font-bold"><KeyRound className="size-5 text-dusk" aria-hidden /> Sign-in PIN</h2>
      <p className="mt-1 text-sm text-dusk">
        {me.hasPin
          ? 'Your account is protected: signing in as you needs your PIN.'
          : 'Right now anyone who has the link can tap your photo and sign in as you. Add a 4–8 digit PIN to protect your account.'}
      </p>
      <form onSubmit={(e) => { e.preventDefault(); update.mutate(next); }} className="mt-4 grid gap-3 sm:grid-cols-2">
        {me.hasPin && (
          <TextField label="Current PIN" type="password" inputMode="numeric" autoComplete="current-password" value={current} onChange={(e) => setCurrent(digits(e.target.value))} />
        )}
        <TextField label={me.hasPin ? 'New PIN' : 'PIN'} type="password" inputMode="numeric" autoComplete="new-password" value={next} onChange={(e) => setNext(digits(e.target.value))} hint="4 to 8 digits" />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" loading={update.isPending && !!next} disabled={next.length < 4 || (me.hasPin && current.length < 4)}>
            {me.hasPin ? 'Change PIN' : 'Save PIN'}
          </Button>
          {me.hasPin && (
            <Button type="button" variant="ghost" disabled={current.length < 4} onClick={() => update.mutate(null)}>Remove PIN</Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function HouseSettings() {
  const me = useMe().data!;
  const { members } = useMembers();
  const [confirm, setConfirm] = useState<{ kind: 'pin' | 'signout'; id: number; name: string } | null>(null);
  const [restoreData, setRestoreData] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const memberAction = useMutation({
    mutationFn: (c: NonNullable<typeof confirm>) =>
      c.kind === 'pin' ? api.del(`/api/admin/members/${c.id}/pin`) : api.post(`/api/admin/members/${c.id}/sign-out`),
    onSuccess: (_d, c) => {
      toast.success(c.kind === 'pin' ? `Reset ${c.name}'s PIN` : `Signed ${c.name} out everywhere`);
      void queryClient.invalidateQueries({ queryKey: qk.members });
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setConfirm(null),
  });
  const restore = useMutation({
    mutationFn: (backup: unknown) => api.post<{ restored: Record<string, number> }>('/api/admin/restore', { backup }),
    onSuccess: (r) => {
      const n = Object.entries(r.restored).map(([t, c]) => `${c} ${t.replace(/_/g, ' ')}`).join(', ');
      toast.success(`Restored backup: ${n}`);
      void queryClient.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setRestoreData(null),
  });

  async function pickFile(f: File | undefined) {
    if (!f) return;
    try {
      setRestoreData(JSON.parse(await f.text()));
    } catch {
      toast.error('That file is not a HomeSweetHome backup.');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <Card>
      <h2 className="text-xl font-bold">House settings</h2>
      <p className="mt-1 text-sm text-dusk">Only you can see this section.</p>

      <h3 className="mt-5 mb-2 font-semibold">Members</h3>
      <ul className="flex flex-col divide-y divide-seam">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <Avatar member={m} size="sm" />
            <span className="min-w-24 flex-1 font-semibold">{m.name}</span>
            <span className="text-xs text-dusk">{m.hasPin ? 'PIN on' : 'No PIN'}</span>
            <PhotoPicker memberId={m.id} name={m.name} hasUpload={isUploaded(m.avatarUrl)} size="sm" />
            <Button size="sm" variant="secondary" disabled={!m.hasPin} onClick={() => setConfirm({ kind: 'pin', id: m.id, name: m.name })}>Reset PIN</Button>
            {m.id !== me.id && (
              <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'signout', id: m.id, name: m.name })}>Sign out everywhere</Button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-6 mb-1 font-semibold">Backup</h3>
      <p className="text-sm text-dusk">
        The free database is deleted by the host 30 days after it was created (plus a 14-day grace period). Download a backup at least once a week, and before moving to a new database.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href="/api/admin/backup" download className="inline-flex h-10 items-center gap-2 rounded-chip bg-lamp px-4 text-sm font-semibold text-lamp-ink hover:brightness-110">
          <Download className="size-4" aria-hidden /> Download backup
        </a>
        <Button variant="secondary" icon={<Upload className="size-4" aria-hidden />} onClick={() => fileRef.current?.click()}>Restore from backup</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" aria-label="Backup file" onChange={(e) => void pickFile(e.target.files?.[0])} />
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'pin' ? `Reset ${confirm?.name}'s PIN?` : `Sign ${confirm?.name} out everywhere?`}
        description={confirm?.kind === 'pin' ? 'They will be able to sign in by tapping their photo until they set a new PIN.' : 'Every device they are signed in on will be signed out.'}
        confirmLabel={confirm?.kind === 'pin' ? 'Reset PIN' : 'Sign out everywhere'}
        tone="danger"
        loading={memberAction.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && memberAction.mutate(confirm)}
      />
      <ConfirmDialog
        open={restoreData !== null}
        title="Restore this backup?"
        description="This replaces all current menus, votes, bookings, chat messages and notifications with the backup's contents. It can't be undone."
        confirmLabel="Restore backup"
        tone="danger"
        loading={restore.isPending}
        onCancel={() => setRestoreData(null)}
        onConfirm={() => restore.mutate(restoreData)}
      />
    </Card>
  );
}
