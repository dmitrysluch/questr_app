import { useEffect, useRef, useState } from 'react';
import { googleMapsSearch } from '../../shared/event-links.ts';
import { t } from '../i18n.ts';

type Place = { id: string };
type MapsWindow = Window & { google?: { maps: { importLibrary: (name: string) => Promise<{ PlaceAutocompleteElement: new () => HTMLElement }> } } };
let loader: Promise<void> | null = null;
function loadGoogleMaps(key: string) {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); loader = null; reject(new Error('MAPS_UNAVAILABLE')); };
    document.head.appendChild(script);
  });
  return loader;
}
export function GooglePlacePicker({ keyValue, onPick }: { keyValue: string; onPick: (point: { mapUrl: string }) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open || !container.current) return;
    let active = true;
    let widget: HTMLElement | undefined;
    void loadGoogleMaps(keyValue).then(async () => {
      if (!active) return;
      const maps = (window as MapsWindow).google?.maps;
      if (!maps) throw new Error('MAPS_UNAVAILABLE');
      const places = await maps.importLibrary('places');
      if (!active) return;
      widget = new places.PlaceAutocompleteElement();
      widget.addEventListener('gmp-select', event => {
        try {
          const place = (event as Event & { placePrediction: { toPlace: () => Place } }).placePrediction.toPlace();
          if (!place.id) throw new Error('MAPS_UNAVAILABLE');
          // Google permits storing Place IDs, but not Places names or addresses.
          onPick({ mapUrl: googleMapsSearch('meeting point', place.id) });
          setOpen(false);
        } catch { if (active) setError(true); }
      });
      container.current?.appendChild(widget);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; widget?.remove(); };
  }, [open, keyValue, onPick]);
  return <div className="google-place-picker"><button className="outline-button" type="button" onClick={() => { setOpen(value => !value); setError(false); }}>{t('events.chooseGooglePlace')}</button>
    {open && <div className="google-place-widget" ref={container} />}
    {error && <p className="field-error" role="alert">{t('events.mapsUnavailable')}</p>}
  </div>;
}
