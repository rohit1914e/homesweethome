// Home / College status: chips everyone sees, and the selector for your own status (manual or GPS).
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LocateFixed, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import type { ManualLocation, Member, MemberLocation } from '@shared/types';
import { Button, ConfirmDialog } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { applyMember, geoErrorMessage, getPosition, useGpsState, useStatusOpen } from '@/lib/gps';
import { qk, queryClient, useMe, useMeta } from '@/lib/queries';
import { formatTime } from '@/lib/time';

export const LOCATION: Record<MemberLocation, { emoji: string; label: string; chip: string; on: string }> = {
  home: { emoji: '🏠', label: 'At Home', chip: 'border-leaf/40 bg-leaf-soft text-leaf', on: 'border-leaf bg-leaf-soft text-leaf' },
  college: { emoji: '🎓', label: 'At College', chip: 'border-sky/40 bg-sky-soft text-sky', on: 'border-sky bg-sky-soft text-sky' },
  away: { emoji: '🚶', label: 'Away', chip: 'border-haze/50 bg-wall text-jasmine', on: 'border-jasmine/70 bg-wall text-jasmine' },
  unavailable: { emoji: '📍', label: 'Location unavailable', chip: 'border-seam bg-room text-haze', on: '' },
};
const MANUAL: ManualLocation[] = ['home', 'college', 'away'];

export function StatusChip({ member, size = 'sm' }: { member: Pick<Member, 'location' | 'locationSource'>; size?: 'xs' | 'sm' }) {
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs';
  if (!member.location) return <span className={`inline-flex items-center rounded-full border border-seam ${pad} font-medium text-haze`}>Not set</span>;
  const l = LOCATION[member.location];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border ${pad} font-semibold ${l.chip}`}>
      <span aria-hidden>{l.emoji}</span>
      {l.label}
      {member.locationSource === 'gps' && member.location !== 'unavailable' && (
        <Navigation className="size-3 opacity-70" aria-label="detected by GPS" />
      )}
    </span>
  );
}

const GPS_NOTES: Partial<Record<string, string>> = {
  checking: 'Checking your location…',
  inaccurate: 'GPS signal is too weak right now, so your last status is kept.',
  not_configured: "Rohit hasn't set the home and college locations yet.",
  denied: 'Location permission is blocked. Allow location for this site in your browser settings.',
  unavailable: 'Location is unavailable on this device right now.',
  unsupported: 'This browser does not support location.',
  timeout: "Couldn't get a GPS fix. Trying again in a few minutes.",
  error: "Couldn't update your status. Trying again in a few minutes.",
};

export function StatusSelector({ className = '' }: { className?: string }) {
  const me = useMe().data;
  const open = useStatusOpen();
  const gps = useGpsState();
  const geofence = useMeta().data?.geofence;
  const [asking, setAsking] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const manual = useMutation({
    mutationFn: (location: ManualLocation) => api.put<{ member: Member }>('/api/members/me/location', { location }).then((r) => r.member),
    onMutate: (location) => {
      const prev = { me: queryClient.getQueryData<Member>(qk.me), members: queryClient.getQueryData<Member[]>(qk.members) };
      if (me) applyMember({ ...me, location, locationSource: 'manual', locationUpdatedAt: new Date().toISOString() });
      return prev;
    },
    onSuccess: (m) => {
      applyMember(m);
      toast.success(`You're ${LOCATION[m.location!].label.toLowerCase()}`);
    },
    onError: (e, _v, prev) => {
      queryClient.setQueryData(qk.me, prev?.me);
      queryClient.setQueryData(qk.members, prev?.members);
      toast.error(errorMessage(e));
    },
  });
  const setGpsEnabled = useMutation({
    mutationFn: (enabled: boolean) => api.put<{ member: Member }>('/api/members/me/gps', { enabled }).then((r) => r.member),
    onSuccess: (m) => {
      applyMember(m);
      toast.success(m.gpsEnabled ? 'Automatic detection is on' : 'Automatic detection is off');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  async function startGps() {
    if (!('geolocation' in navigator)) return toast.error(geoErrorMessage(undefined));
    setRequesting(true);
    try {
      await getPosition(); // the browser's own permission prompt appears here
      setAsking(false);
      setGpsEnabled.mutate(true);
    } catch (err) {
      toast.error(geoErrorMessage((err as GeolocationPositionError)?.code));
    } finally {
      setRequesting(false);
    }
  }

  if (!me) return null;
  if (!open) {
    return <p className={`text-sm text-dusk ${className}`}>Status is shared from 8 AM to 3 PM, during college hours.</p>;
  }
  const overridden = me.gpsEnabled && me.locationSource === 'manual';
  const note = me.gpsEnabled && !overridden ? GPS_NOTES[gps.status] : undefined;

  return (
    <div className={className}>
      <div role="group" aria-label="Your status" className="grid grid-cols-3 gap-2">
        {MANUAL.map((loc) => {
          const l = LOCATION[loc];
          const on = me.location === loc;
          return (
            <button
              key={loc}
              type="button"
              aria-pressed={on}
              onClick={() => !(on && me.locationSource === 'manual') && manual.mutate(loc)}
              className={`flex items-center justify-center gap-1.5 rounded-chip border px-2 py-2.5 text-sm font-semibold transition ${on ? l.on : 'border-seam bg-wall text-dusk hover:border-haze hover:text-jasmine'}`}
            >
              <span aria-hidden className="text-base">{l.emoji}</span>
              {l.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {me.gpsEnabled ? (
          <>
            <span className="inline-flex items-center gap-1.5 font-semibold text-jasmine">
              <LocateFixed className="size-4 text-lamp" aria-hidden /> Automatic detection on
            </span>
            {overridden ? (
              <Button size="sm" variant="secondary" loading={setGpsEnabled.isPending} onClick={() => setGpsEnabled.mutate(true)}>
                Use GPS again
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setGpsEnabled.mutate(false)} disabled={setGpsEnabled.isPending}>
              Turn off
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" icon={<LocateFixed className="size-4" aria-hidden />} onClick={() => setAsking(true)}>
            Detect automatically with GPS
          </Button>
        )}
      </div>
      {(overridden || note || (me.gpsEnabled && gps.status === 'ok' && me.locationUpdatedAt)) && (
        <p className="mt-2 text-xs text-dusk" aria-live="polite">
          {overridden
            ? 'Your manual choice overrides GPS for today.'
            : note ?? (me.locationUpdatedAt ? `Detected by GPS, checked at ${formatTime(new Date(gps.at).toISOString())}.` : '')}
        </p>
      )}

      <ConfirmDialog
        open={asking}
        title="Use your location to set your status?"
        confirmLabel="Allow location"
        loading={requesting}
        onCancel={() => setAsking(false)}
        onConfirm={() => void startGps()}
        description={
          <span className="flex flex-col gap-2">
            <span>Your browser will ask for permission. When you allow it, HomeSweetHome checks whether you're within the home or college area when you open the site and every 5 minutes while it stays open.</span>
            <span>Your exact location is never saved or shown to anyone. Only At Home, At College, Away or Location unavailable is shared, between 8 AM and 3 PM.</span>
            <span>Nothing runs after you close the website. You can turn it off any time.</span>
            {geofence && (!geofence.home || !geofence.college) && (
              <span className="text-lamp">Rohit hasn't set {!geofence.home && !geofence.college ? 'the home and college locations' : !geofence.home ? 'the home location' : 'the college location'} yet.</span>
            )}
          </span>
        }
      />
    </div>
  );
}
