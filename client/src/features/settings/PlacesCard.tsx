// Rohit only: the home and college areas used for automatic status. Coordinates stay with Rohit.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LocateFixed, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import type { Place } from '@shared/types';
import { Button, Card, TextField } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { geoErrorMessage, getPosition } from '@/lib/gps';
import { qk } from '@/lib/queries';

const LABEL = { home: 'Home', college: 'College' } as const;

function PlaceForm({ kind, place }: { kind: Place['kind']; place?: Place }) {
  const qc = useQueryClient();
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('150');
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    setLat(place ? String(place.lat) : '');
    setLng(place ? String(place.lng) : '');
    setRadius(place ? String(place.radiusM) : '150');
  }, [place]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'places'] });
    void qc.invalidateQueries({ queryKey: qk.meta });
  };
  const save = useMutation({
    mutationFn: () => api.put(`/api/admin/places/${kind}`, { lat: Number(lat), lng: Number(lng), radiusM: Number(radius) }),
    onSuccess: () => {
      toast.success(`Saved the ${LABEL[kind].toLowerCase()} area`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/admin/places/${kind}`),
    onSuccess: () => {
      toast.success(`Removed the ${LABEL[kind].toLowerCase()} area`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  async function fillFromHere() {
    setLocating(true);
    try {
      const p = await getPosition();
      setLat(p.coords.latitude.toFixed(7));
      setLng(p.coords.longitude.toFixed(7));
      toast.success(`Filled in your current location (±${Math.round(p.coords.accuracy)} m)`);
    } catch (err) {
      toast.error(geoErrorMessage((err as GeolocationPositionError)?.code));
    } finally {
      setLocating(false);
    }
  }
  const valid =
    lat !== '' && lng !== '' && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 && Number(radius) >= 25 && Number(radius) <= 10000;

  return (
    <form
      className="rounded-chip border border-seam p-4"
      aria-label={`${LABEL[kind]} area`}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <MapPin className="size-4 text-dusk" aria-hidden /> {LABEL[kind]}
        </h3>
        <span className={`text-xs ${place ? 'text-leaf' : 'text-haze'}`}>{place ? `Set, ${place.radiusM} m radius` : 'Not set'}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Latitude" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value.trim())} placeholder="13.0000000" />
        <TextField label="Longitude" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value.trim())} placeholder="80.0000000" />
        <TextField label="Radius (metres)" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, ''))} hint="25 to 10,000" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={save.isPending} disabled={!valid}>
          Save {LABEL[kind].toLowerCase()} area
        </Button>
        <Button type="button" size="sm" variant="secondary" loading={locating} icon={<LocateFixed className="size-4" aria-hidden />} onClick={() => void fillFromHere()}>
          Use my current location
        </Button>
        {place && (
          <Button type="button" size="sm" variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        )}
      </div>
    </form>
  );
}

export function PlacesCard() {
  const places = useQuery({
    queryKey: ['admin', 'places'],
    queryFn: () => api.get<{ places: Place[] }>('/api/admin/places').then((r) => r.places),
  });
  const byKind = new Map((places.data ?? []).map((p) => [p.kind, p]));
  return (
    <Card>
      <h2 className="text-xl font-bold">Home and college areas</h2>
      <p className="mt-1 text-sm text-dusk">
        Used for automatic status: anyone inside an area's radius shows as At Home or At College. These coordinates are visible only to you, and members' own locations are never stored.
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <PlaceForm kind="home" place={byKind.get('home')} />
        <PlaceForm kind="college" place={byKind.get('college')} />
      </div>
    </Card>
  );
}
