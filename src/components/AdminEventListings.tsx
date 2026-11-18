import { useEffect, useState, type FormEvent } from 'react';
import type { AppConfig } from '../../shared/schema.ts';
import { wallTime, wallTimeToInstant } from '../../shared/events.ts';
import type { EventListing } from '../../shared/event-listings.ts';
import { api } from '../api.ts';
import { errorText, getLocale, locationName, t } from '../i18n.ts';
import { useCommunities } from '../community-catalog.tsx';
import { LocationPicker } from './Discovery.tsx';
import { PlacePicker } from './PlacePicker.tsx';

type Form = { title: string; descriptionMarkdown: string; start: string; end: string; timeZone: string;
  cityLocationId: string; placeId: string | null; mapsUrl: string; venueName: string; sourceUrl: string; organizerName: string;
  communityId: string; status: EventListing['status'] };
function empty(): Form {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { title: '', descriptionMarkdown: '', start: wallTime(new Date(Date.now() + 86400000).toISOString(), timeZone),
    end: wallTime(new Date(Date.now() + 93600000).toISOString(), timeZone), timeZone,
    cityLocationId: '', placeId: null, mapsUrl: '', venueName: '', sourceUrl: '', organizerName: '', communityId: '', status: 'draft' };
}
function fromListing(listing: EventListing): Form {
  return { title: listing.title, descriptionMarkdown: listing.descriptionMarkdown,
    start: wallTime(listing.startsAt, listing.timeZone), end: wallTime(listing.endsAt, listing.timeZone), timeZone: listing.timeZone,
    cityLocationId: listing.city.id, placeId: listing.place?.id ?? null, mapsUrl: listing.mapsUrl ?? '', venueName: listing.venueName ?? '',
    sourceUrl: listing.sourceUrl, organizerName: listing.organizerName, communityId: listing.communityId ?? '', status: listing.status };
}
export function AdminEventListings({ config }: { config: AppConfig }) {
  const communities = useCommunities();
  const [listings, setListings] = useState<EventListing[]>([]);
  const [editing, setEditing] = useState<EventListing | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const zones = [...new Set(['UTC', form.timeZone, ...Intl.supportedValuesOf('timeZone')])].sort();
  useEffect(() => { void api<{ listings: EventListing[] }>('/event-listings/admin').then(result => setListings(result.listings)).catch(setError); }, []);
  function change(patch: Partial<Form>) { setForm(old => ({ ...old, ...patch })); }
  function select(listing: EventListing) { setEditing(listing); setForm(fromListing(listing)); setError(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function reset() { setEditing(null); setForm(empty()); setError(null); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const body = { title: form.title, descriptionMarkdown: form.descriptionMarkdown,
        startsAt: wallTimeToInstant(form.start, form.timeZone), endsAt: wallTimeToInstant(form.end, form.timeZone), timeZone: form.timeZone,
        cityLocationId: form.cityLocationId || null, placeId: form.placeId, mapsUrl: form.mapsUrl || null, venueName: form.mapsUrl ? form.venueName : null,
        sourceUrl: form.sourceUrl, organizerName: form.organizerName, communityId: form.communityId || null, status: form.status };
      const result = await api<{ listing: EventListing }>(editing ? `/event-listings/admin/${editing.id}` : '/event-listings/admin',
        { method: editing ? 'PUT' : 'POST', body: editing ? { ...body, revision: editing.revision } : body });
      setListings(old => [result.listing, ...old.filter(item => item.id !== result.listing.id)]);
      reset();
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  const visible = listings.filter(item => `${item.title} ${item.city.name} ${item.organizerName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section className="admin-listings">
    <div className="page-heading"><span className="eyebrow">QUESTR / {t('nav.admin')}</span><h1>{t('listings.adminTitle')}</h1></div>
    <form className="paper-card event-form admin-listing-form" onSubmit={event => void save(event)}><fieldset disabled={busy}>
      <label htmlFor="listing-title">{t('listings.name')}</label><input id="listing-title" value={form.title} onChange={event => change({ title: event.target.value })} required minLength={3} maxLength={160} />
      <label htmlFor="listing-description">{t('listings.description')}</label><textarea id="listing-description" value={form.descriptionMarkdown} onChange={event => change({ descriptionMarkdown: event.target.value })} required minLength={10} maxLength={12000} rows={5} />
      <div className="event-form-grid"><label>{t('listings.start')}<input type="datetime-local" value={form.start} onChange={event => change({ start: event.target.value })} required /></label><label>{t('listings.end')}<input type="datetime-local" value={form.end} min={form.start} onChange={event => change({ end: event.target.value })} required /></label></div>
      <label htmlFor="listing-zone">{t('events.zone')}</label><select id="listing-zone" value={form.timeZone} onChange={event => change({ timeZone: event.target.value })}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select>
      <LocationPicker citiesOnly single collapseWhenSelected label={t('listings.city')} value={form.cityLocationId ? [form.cityLocationId] : []} onChange={ids => change({ cityLocationId: ids[0] ?? '', placeId: null, mapsUrl: '', venueName: '' })} />
      {form.cityLocationId && <><p className="field-hint">{t('listings.venueHint')}</p><PlacePicker key={form.cityLocationId} cityId={form.cityLocationId} placeId={form.placeId} meetingMapUrl={form.mapsUrl} selected={editing?.city.id === form.cityLocationId ? editing.place : null} googleKey={config.googleMapsBrowserKey} label={t('listings.venue')} googleLabel={form.venueName} onPick={pick => {
        if (pick?.kind === 'saved') change({ placeId: pick.id, mapsUrl: '', venueName: '' });
        else if (pick?.kind === 'google') change({ placeId: null, mapsUrl: pick.mapUrl, venueName: pick.name });
        else change({ placeId: null, mapsUrl: '', venueName: '' });
      }} />{form.mapsUrl && <><label htmlFor="listing-venue-name">{t('listings.venueName')}</label><input id="listing-venue-name" value={form.venueName} onChange={event => change({ venueName: event.target.value })} required minLength={2} maxLength={160} /></>}</>}
      <label htmlFor="listing-organizer">{t('listings.organizer')}</label><input id="listing-organizer" value={form.organizerName} onChange={event => change({ organizerName: event.target.value })} required minLength={2} maxLength={160} />
      <label htmlFor="listing-source">{t('listings.sourceUrl')}</label><input id="listing-source" type="url" pattern="https://.*" value={form.sourceUrl} onChange={event => change({ sourceUrl: event.target.value })} required maxLength={2048} placeholder="https://…" />
      <label htmlFor="listing-community">{t('listings.community')}</label><select id="listing-community" value={form.communityId} onChange={event => change({ communityId: event.target.value })}><option value="">{t('listings.anyCommunity')}</option>{communities.map(item => <option value={item.id} key={item.id}>{item.name[getLocale()]}</option>)}</select>
      <label htmlFor="listing-status">{t('listings.status')}</label><select id="listing-status" value={form.status} onChange={event => change({ status: event.target.value as EventListing['status'] })}><option value="draft">{t('listings.draft')}</option><option value="published">{t('listings.published')}</option><option value="cancelled">{t('listings.cancelled')}</option></select>
      {error !== null && <p className="field-error" role="alert">{errorText(error)}</p>}
      <div className="event-actions"><button className="pixel-button small" disabled={busy || !form.cityLocationId || !form.placeId && !form.mapsUrl}>{t(editing ? 'listings.save' : 'listings.add')}</button>{editing && <button type="button" className="outline-button" onClick={reset}>{t('common.cancel')}</button>}</div>
    </fieldset></form>
    <input className="admin-place-search" aria-label={t('listings.search')} placeholder={t('listings.search')} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="adventure-list">{visible.map(item => <button className="paper-card adventure-card" type="button" key={item.id} onClick={() => select(item)}><div className="event-status">{t(`listings.${item.status}`)} · {item.revision}</div><h2>{item.title}</h2><p>{locationName(item.city.id, item.city.name)} · {item.organizerName}</p><small>{item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString(getLocale()) : ''}</small></button>)}</div>
  </section>;
}
