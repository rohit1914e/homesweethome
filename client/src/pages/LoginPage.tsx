import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import type { PublicMember } from '@shared/types';
import { Wordmark } from '@/components/Brand';
import { Portrait } from '@/components/Portrait';
import { Button, Spinner } from '@/components/ui';
import { api, ApiError, errorMessage } from '@/lib/api';
import { safeFrom, useLogin } from '@/lib/auth';
import { useMe } from '@/lib/queries';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const members = useQuery({
    queryKey: ['auth', 'members'],
    queryFn: () => api.get<{ members: PublicMember[] }>('/api/auth/members').then((r) => r.members),
    retry: (n) => n < 12, // the free server may be waking up
    retryDelay: 5000,
  });
  const login = useLogin();
  const [pinFor, setPinFor] = useState<PublicMember | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (me.data) navigate(safeFrom(location.state), { replace: true });
  }, [me.data, navigate, location.state]);

  useEffect(() => {
    if (pinFor) pinRef.current?.focus();
  }, [pinFor]);

  async function enter(member: PublicMember, withPin?: string) {
    setError(null);
    try {
      await login.mutateAsync({ memberId: member.id, pin: withPin });
      navigate(safeFrom(location.state), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pin_required') {
        setPinFor(member);
        setPin('');
      } else if (err instanceof ApiError && err.code === 'invalid_pin') {
        setError('That PIN is not right. Try again.');
        setPin('');
      } else {
        setError(errorMessage(err));
      }
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center px-4 py-10 sm:py-16">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] bg-[radial-gradient(ellipse_at_top,#f2b84b1f,transparent_65%)]" />
      <div className="relative flex w-full max-w-4xl flex-col items-center">
        <div className="mb-10 flex items-center gap-3">
          <Wordmark size="lg" />
        </div>
        <h1 className="text-center text-4xl font-bold tracking-tight [font-variation-settings:'opsz'_96] sm:text-6xl">Who's home?</h1>
        <p className="mt-3 text-center text-lg text-dusk">Tap your photo to come in.</p>

        {members.isPending ? (
          <div className="mt-16"><Spinner label="Waking up the house… this can take up to a minute on first visit." /></div>
        ) : members.error ? (
          <p role="alert" className="mt-16 text-center text-chili">{errorMessage(members.error)}</p>
        ) : (
          <ul className="mt-12 grid w-full grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6" aria-label="Members">
            {members.data.map((m, i) => (
              <li key={m.id} className="hsh-rise" style={{ animationDelay: `${i * 70}ms` }}>
                <button
                  type="button"
                  onClick={() => void enter(m)}
                  disabled={login.isPending}
                  aria-label={`Sign in as ${m.name}`}
                  className={`group flex w-full flex-col items-center gap-3 rounded-tile border bg-room p-4 transition duration-200 hover:-translate-y-0.5 hover:border-lamp/60 hover:shadow-lamp disabled:opacity-60 sm:p-5 ${
                    pinFor?.id === m.id ? 'border-lamp shadow-lamp' : 'border-seam'
                  }`}
                >
                  <Portrait member={m} eager className="aspect-square w-full max-w-44 rounded-full" />
                  <span className="text-lg font-semibold sm:text-xl">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {pinFor && (
          <form
            className="mt-8 flex w-full max-w-sm flex-col gap-3 rounded-tile border border-seam bg-room p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void enter(pinFor, pin);
            }}
          >
            <label htmlFor="pin" className="font-semibold">
              {pinFor.name}, enter your PIN
            </label>
            <input
              id="pin"
              ref={pinRef}
              inputMode="numeric"
              autoComplete="current-password"
              type="password"
              pattern="\d{4,8}"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="h-12 rounded-chip border border-seam bg-wall px-4 text-center text-2xl tracking-[0.5em] text-jasmine"
            />
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setPinFor(null)}>Cancel</Button>
              <Button type="submit" className="flex-1" loading={login.isPending} disabled={pin.length < 4}>Come in</Button>
            </div>
          </form>
        )}
        {error && <p role="alert" className="mt-4 text-center text-chili">{error}</p>}
      </div>
    </main>
  );
}
