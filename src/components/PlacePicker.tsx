import { useEffect, useRef, useState } from 'react';
import type { Location } from '../../shared/discovery.ts';
import type { Place } from '../../shared/places.ts';
import { googleMapsSearch } from '../../shared/event-links.ts';
import { api } from '../api.ts';
import { errorText, getLocale, t } from '../i18n.ts';
import { loadGooglePlaces, type GooglePrediction } from '../googlePlaces.ts';
import { SelectionPicker, type Choice } from './SelectionPicker.tsx';

type Pick = { kind: 'saved'; id: string } | { kind: 'google'; mapUrl: string; name: string } | null;
type GoogleChoice = { id: string; label: string; prediction: GooglePrediction };
function googleId(mapUrl: string): string | null {
  if (!mapUrl) return null;
  try { return new URL(mapUrl).searchParams.get('query_place_id') ?? mapUrl; }
  catch { return mapUrl; }
}

export function PlacePicker({ cityId, placeId, meetingMapUrl, selected, googleKey, label, googleLabel, focusOnMount = false, onPick }: {
  cityId: string; placeId: string | null; meetingMapUrl: string; selected?: Place | null; googleKey: string; label?: string; googleLabel?: string; focusOnMount?: boolean;
  onPick: (pick: Pick) => void;
}) {
  const [query, setQuery] = useState('');
  const [city, setCity] = useState<Location | null>(null);
  const [saved, setSaved] = useState<Place[]>([]);
  const [google, setGoogle] = useState<GoogleChoice[]>([]);
  const [pickedSaved, setPickedSaved] = useState<Place | null>(selected ?? null);
  const [pickedGoogle, setPickedGoogle] = useState<Choice | null>(null);
  const [savedLoading, setSavedLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [picking, setPicking] = useState(false);
  const [savedError, setSavedError] = useState<unknown>(null);
  const [googleError, setGoogleError] = useState(false);
  const session = useRef<object | null>(null);

  useEffect(() => {
    if (!cityId) { setCity(null); return; }
    let active = true;
    setCity(null); session.current = null;
    void api<{ locations: Location[] }>(`/locations?ids=${encodeURIComponent(cityId)}`)
      .then(result => { if (active) setCity(result.locations[0] ?? null); })
      .catch(() => { if (active) setCity(null); });
    return () => { active = false; };
  }, [cityId]);

  useEffect(() => {
    if (!cityId || cityId === 'online') { setSaved([]); return; }
    let active = true;
    setSaved([]); setSavedLoading(true); setSavedError(null);
    const timer = setTimeout(() => {
      void api<{ places: Place[] }>(`/places?cityId=${encodeURIComponent(cityId)}&q=${encodeURIComponent(query)}`)
        .then(result => { if (active) { setSaved(result.places); if (placeId) setPickedSaved(old => result.places.find(place => place.id === placeId) ?? old); } })
        .catch(problem => { if (active) setSavedError(problem); })
        .finally(() => { if (active) setSavedLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [cityId, query, placeId]);

  useEffect(() => {
    if (!googleKey || !city || query.trim().length < 2) { setGoogle([]); setGoogleLoading(false); return; }
    let active = true;
    setGoogle([]); setGoogleLoading(true); setGoogleError(false);
    const timer = setTimeout(() => {
      void (async () => {
        const library = await loadGooglePlaces(googleKey);
        if (!active) return;
        if (!session.current) session.current = new library.AutocompleteSessionToken();
        const country = city.parentId?.startsWith('country:') ? city.parentId.slice(8).toLowerCase() : undefined;
        const result = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: `${query.trim()}, ${city.name}`, sessionToken: session.current, language: getLocale(),
          ...(country ? { region: country, includedRegionCodes: [country] } : {}),
        });
        if (active) setGoogle(result.suggestions.flatMap((item, index) => item.placePrediction
          ? [{ id: `google:${index}`, label: item.placePrediction.text.toString(), prediction: item.placePrediction }] : []));
      })().catch(() => { if (active) setGoogleError(true); }).finally(() => { if (active) setGoogleLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [city, query, googleKey]);

  const savedChoices: Choice[] = saved.map(place => ({ id: `saved:${place.id}`, label: place.name, detail: place.address }));
  const googleChoices: Choice[] = google.map(item => ({ id: item.id, label: item.label, source: 'google' }));
  const currentGoogleId = googleId(meetingMapUrl);
  const value = placeId ? `saved:${placeId}` : currentGoogleId ? `google:selected:${currentGoogleId}` : '';
  const selectedChoices: Choice[] = [
    ...savedChoices,
    ...(pickedSaved ? [{ id: `saved:${pickedSaved.id}`, label: pickedSaved.name, detail: pickedSaved.address }] : []),
    ...(selected ? [{ id: `saved:${selected.id}`, label: selected.name, detail: selected.address }] : []),
    ...(currentGoogleId ? [{ id: value, label: pickedGoogle?.id === value ? pickedGoogle.label : googleLabel ?? t('places.googlePoint'), source: 'google' as const }] : []),
  ];
  async function choose(ids: string[]) {
    const id = ids[0];
    if (!id) { setPickedGoogle(null); onPick(null); return; }
    if (id.startsWith('saved:')) {
      const place = saved.find(item => `saved:${item.id}` === id);
      if (!place) return;
      setPickedSaved(place); setPickedGoogle(null); session.current = null;
      onPick({ kind: 'saved', id: place.id });
      return;
    }
    const item = google.find(item => item.id === id);
    if (!item || picking) return;
    setPicking(true); setGoogleError(false);
    try {
      const place = item.prediction.toPlace();
      await place.fetchFields({ fields: ['displayName'] });
      if (!place.id) throw new Error('MAPS_UNAVAILABLE');
      const mapUrl = googleMapsSearch('meeting point', place.id);
      setPickedGoogle({ id: `google:selected:${place.id}`, label: place.displayName || item.label, source: 'google' });
      session.current = null;
      onPick({ kind: 'google', mapUrl, name: place.displayName || item.label });
    } catch { setGoogleError(true); }
    finally { setPicking(false); }
  }
  return <><SelectionPicker label={label ?? t('places.pickPlace')} placeholder={t('places.search')} value={value ? [value] : []}
    selected={selectedChoices} items={[...savedChoices, ...googleChoices]} query={query} onQuery={next => { if (!next) session.current = null; setQuery(next); }}
    onChange={ids => void choose(ids)} loading={picking} pending={savedLoading || googleLoading} focusOnMount={focusOnMount} replaceOnSelect limit={1} />
    {!googleKey && <p className="field-hint">{t('places.googleNotConfigured')}</p>}
    {currentGoogleId && <p className="field-hint">{t('places.googlePrivate')}</p>}
    {!!savedError && <p className="field-error" role="alert">{errorText(savedError)}</p>}
    {googleError && <p className="field-error" role="alert">{t('places.googleUnavailable')}</p>}
  </>;
}
