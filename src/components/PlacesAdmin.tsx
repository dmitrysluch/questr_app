import { useEffect, useState, type FormEvent } from 'react';
import type { Place } from '../../shared/places.ts';
import { api } from '../api.ts';
import { errorText, locationName, t } from '../i18n.ts';
import { LocationPicker } from './Discovery.tsx';

export function PlacesAdmin() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [editing, setEditing] = useState<Place | null>(null);
  const [cityId, setCityId] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  useEffect(() => { void api<{ places: Place[] }>('/places/admin').then(result => setPlaces(result.places)).catch(setError); }, []);
  function reset() { setEditing(null); setCityId(''); setName(''); setAddress(''); setActive(true); }
  function edit(place: Place) { setEditing(place); setCityId(place.cityLocationId); setName(place.name); setAddress(place.address); setActive(place.active); setError(null); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const input = { cityLocationId: cityId, name, address, active };
      const result = await api<{ place: Place }>(editing ? `/places/admin/${editing.id}` : '/places/admin',
        { method: editing ? 'PUT' : 'POST', body: editing ? { ...input, revision: editing.revision } : input });
      setPlaces(old => [...old.filter(place => place.id !== result.place.id), result.place].sort((a, b) => a.cityName.localeCompare(b.cityName) || a.name.localeCompare(b.name)));
      reset();
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  const visible = places.filter(place => `${place.name} ${place.address} ${place.cityName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="admin-places"><h2>{t('places.adminTitle')}</h2>
    <form className="paper-card admin-place-form" onSubmit={event => void save(event)}>
      {editing ? <p>{locationName(editing.cityLocationId, editing.cityName)}</p> : <LocationPicker citiesOnly single value={cityId ? [cityId] : []} onChange={ids => setCityId(ids[0] ?? '')} />}
      <label htmlFor="place-name">{t('places.name')}</label><input id="place-name" required minLength={2} maxLength={160} value={name} onChange={event => setName(event.target.value)} />
      <label htmlFor="place-address">{t('places.address')}</label><input id="place-address" required minLength={3} maxLength={240} value={address} onChange={event => setAddress(event.target.value)} />
      {editing && <label className="checkbox-label"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />{t('places.active')}</label>}
      {error !== null && <p className="field-error" role="alert">{errorText(error)}</p>}
      <div className="admin-place-actions"><button className="pixel-button small" disabled={busy || !cityId}>{t(editing ? 'places.save' : 'places.add')}</button>{editing && <button type="button" className="text-button" onClick={reset}>{t('common.cancel')}</button>}</div>
    </form>
    <input className="admin-place-search" aria-label={t('places.search')} placeholder={t('places.search')} value={search} onChange={event => setSearch(event.target.value)} />
    <ul className="admin-place-list">{visible.map(place => <li key={place.id}><button type="button" className="text-button" onClick={() => edit(place)}><strong>{place.name}</strong> · {place.address} · {locationName(place.cityLocationId, place.cityName)}{!place.active && ` · ${t('places.archived')}`}</button></li>)}</ul>
  </section>;
}
