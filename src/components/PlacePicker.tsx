import { useEffect, useState } from 'react';
import type { Place } from '../../shared/places.ts';
import { api } from '../api.ts';
import { errorText, t } from '../i18n.ts';
import { SelectionPicker } from './SelectionPicker.tsx';

export function PlacePicker({ cityId, value, selected, onChange }: {
  cityId: string; value: string | null; selected?: Place | null; onChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Place[]>([]);
  const [picked, setPicked] = useState<Place | null>(selected ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!cityId || cityId === 'online') { setItems([]); return; }
    let active = true;
    setLoading(true); setError(null);
    const timer = setTimeout(() => {
      api<{ places: Place[] }>(`/places?cityId=${encodeURIComponent(cityId)}&q=${encodeURIComponent(query)}`)
        .then(result => { if (active) { setItems(result.places); if (value) setPicked(old => result.places.find(place => place.id === value) ?? old); } })
        .catch(problem => { if (active) setError(problem); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [cityId, query]);
  const choice = (place: Place) => ({ id: place.id, label: place.name, detail: place.address });
  return <><SelectionPicker label={t('places.publicVenue')} placeholder={t('places.search')} value={value ? [value] : []}
    selected={[...items, ...(picked ? [picked] : []), ...(selected ? [selected] : [])].map(choice)} items={items.map(choice)} query={query} onQuery={setQuery}
    onChange={ids => { setPicked(items.find(place => place.id === ids[0]) ?? null); onChange(ids[0] ?? null); }} loading={loading} replaceOnSelect limit={1} />
    {!!error && <p className="field-error" role="alert">{errorText(error)}</p>}</>;
}
