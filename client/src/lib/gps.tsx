// Automatic Home / College status while the website is open (opt-in per member).
// The browser's coordinates are sent once per check; the server turns them into a status and
// discards them. Nothing runs after the tab is closed — browsers don't allow that for websites.
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Member } from '@shared/types';
import { statusWindowAt } from '@shared/statusWindow';
import { api, ApiError } from './api';
import { qk, queryClient, useMe } from './queries';

export const GPS_INTERVAL_MS = 5 * 60_000;
export const GPS_MAX_ACCURACY_M = 500;

export type GpsState =
  | 'off' | 'closed' | 'checking' | 'ok' | 'inaccurate' | 'manual_override'
  | 'not_configured' | 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'error';

let state: { status: GpsState; at: number } = { status: 'off', at: 0 };
const listeners = new Set<() => void>();
function setGps(status: GpsState) {
  state = { status, at: Date.now() };
  listeners.forEach((l) => l());
}
export function useGpsState() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

export function applyMember(member: Member) {
  queryClient.setQueryData<Member>(qk.me, (old) => (old && old.id === member.id ? member : old));
  queryClient.setQueryData<Member[]>(qk.members, (old) => old?.map((m) => (m.id === member.id ? member : m)));
}

/** True during college hours (8 AM – 3 PM IST); re-evaluated every 30 s. Refetches statuses when it flips. */
export function useStatusOpen(): boolean {
  const [open, setOpen] = useState(() => statusWindowAt(new Date()).open);
  useEffect(() => {
    const t = setInterval(() => {
      const now = statusWindowAt(new Date()).open;
      setOpen((prev) => {
        if (prev !== now) {
          void queryClient.invalidateQueries({ queryKey: qk.members });
          void queryClient.invalidateQueries({ queryKey: qk.me });
          void queryClient.invalidateQueries({ queryKey: qk.meta });
        }
        return now;
      });
    }, 30_000);
    return () => clearInterval(t);
  }, []);
  return open;
}

type Reading = { lat: number; lng: number; accuracy: number } | { error: 'denied' | 'unavailable' };

async function report(body: Reading) {
  try {
    const r = await api.post<{ applied: boolean; reason?: GpsState; member: Member }>('/api/members/me/gps/reading', body);
    applyMember(r.member);
    if ('error' in body) setGps(body.error);
    else setGps(r.applied ? 'ok' : (r.reason ?? 'ok'));
  } catch (e) {
    setGps(e instanceof ApiError && e.code === 'status_closed' ? 'closed' : 'error');
  }
}

/** Ask the browser once. Resolves with the position or the GeolocationPositionError code. */
export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 }),
  );
}

export function geoErrorMessage(code: number | undefined): string {
  if (code === 1) return 'Location permission is blocked. Allow location for this site in your browser settings, then try again.';
  if (code === 2) return 'Your device could not determine a location right now.';
  if (code === 3) return 'Getting a GPS fix took too long. Try again near a window or outdoors.';
  return 'This browser does not support location.';
}

/** Mounted once while signed in: checks on open, every 5 minutes while visible, and on permission changes. */
export function GpsWatcher() {
  const me = useMe().data;
  const open = useStatusOpen();
  const enabled = !!me?.gpsEnabled;
  useEffect(() => {
    if (!enabled) return setGps('off');
    if (!open) return setGps('closed');
    if (!('geolocation' in navigator)) {
      setGps('unsupported');
      void report({ error: 'unavailable' });
      return;
    }
    let busy = false;
    let disposed = false;
    const check = async () => {
      if (busy || disposed || document.visibilityState !== 'visible') return;
      busy = true;
      setGps('checking');
      try {
        const pos = await getPosition();
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        // Too imprecise to tell home from college: keep the last status, try again later.
        if (accuracy > GPS_MAX_ACCURACY_M) setGps('inaccurate');
        else await report({ lat, lng, accuracy });
      } catch (err) {
        const code = (err as GeolocationPositionError)?.code;
        if (code === 1) await report({ error: 'denied' });
        else if (code === 2) await report({ error: 'unavailable' });
        else setGps('timeout'); // transient: keep the last status
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), GPS_INTERVAL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    let perm: PermissionStatus | undefined;
    navigator.permissions
      ?.query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        perm = p;
        p.onchange = () => void check(); // allowed / blocked in browser settings
      })
      .catch(() => {});
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      if (perm) perm.onchange = null;
    };
  }, [enabled, open]);
  return null;
}
