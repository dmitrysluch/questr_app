import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, MapPin, Plus } from 'lucide-react';
import type { AppConfig } from '../../shared/schema.ts';
import type { EventListing, EventListingDetail } from '../../shared/event-listings.ts';
import type { EventCreationAccess, AdventureDetail } from '../../shared/events.ts';
import { api } from '../api.ts';
import { errorText, getLocale, locationName, t } from '../i18n.ts';
import { useCommunities } from '../community-catalog.tsx';
import { LocationPicker } from './Discovery.tsx';
import { Markdown } from './Markdown.tsx';
import { EventEditor } from './Adventures.tsx';

function date(listing: EventListing) {
  return new Intl.DateTimeFormat(getLocale(), { timeZone: listing.timeZone, dateStyle: 'medium', timeStyle: 'short' })
    .formatRange(new Date(listing.startsAt), new Date(listing.endsAt));
}
function venue(listing: EventListing) {
  return listing.place ? `${listing.place.name} · ${listing.place.address}` : `${listing.venueName} · ${locationName(listing.city.id, listing.city.name)}`;
}
export function EventListings({ config, spokenLanguages, communityIds }: { config: AppConfig; spokenLanguages: string[]; communityIds: string[] }) {
  const communities = useCommunities();
  const [id, setId] = useState(location.hash.split('/')[1] ?? '');
  const [list, setList] = useState<EventListing[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [detail, setDetail] = useState<EventListingDetail | null>(null);
  const [cityId, setCityId] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [access, setAccess] = useState<EventCreationAccess | null>(null);
  const [editor, setEditor] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { const change = () => { setId(location.hash.split('/')[1] ?? ''); setDetail(null); setError(null); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    if (id) {
      void Promise.all([api<{ listing: EventListingDetail }>(`/event-listings/${id}`), api<EventCreationAccess>('/events/create-access')])
        .then(([result, creation]) => { if (active) { setDetail(result.listing); setAccess(creation); } })
        .catch(problem => { if (active) setError(problem); })
        .finally(() => { if (active) setLoading(false); });
    } else {
      const query = new URLSearchParams();
      if (cityId) query.set('cityId', cityId);
      if (communityId) query.set('communityId', communityId);
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      void api<{ listings: EventListing[]; nextOffset: number | null }>(`/event-listings?${query}`)
        .then(result => { if (active) { setList(result.listings); setNextOffset(result.nextOffset); } })
        .catch(problem => { if (active) setError(problem); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [id, cityId, communityId, from, to]);
  useEffect(() => {
    if (!detail || !access) return;
    let active = true;
    void api<EventCreationAccess>(`/events/create-access?locationId=${encodeURIComponent(detail.city.id)}`)
      .then(result => { if (active) setAccess(result); }).catch(problem => { if (active) setError(problem); });
    return () => { active = false; };
  }, [detail?.id]);
  async function more() {
    if (nextOffset === null || loading) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ offset: String(nextOffset) });
      if (cityId) query.set('cityId', cityId);
      if (communityId) query.set('communityId', communityId);
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      const result = await api<{ listings: EventListing[]; nextOffset: number | null }>(`/event-listings?${query}`);
      setList(old => [...old, ...result.listings]); setNextOffset(result.nextOffset);
    } catch (problem) { setError(problem); } finally { setLoading(false); }
  }
  const communityName = (value: string | null) => communities.find(item => item.id === value)?.name[getLocale()];
  return <section className="adventures event-listings">
    <div className="adventure-heading">{id ? <button className="text-button" onClick={() => { location.hash = 'listings'; }}><ArrowLeft size={16} />{t('listings.back')}</button> : <h1>{t('listings.title')}</h1>}</div>
    {!id && <><div className="event-tabs"><button onClick={() => { location.hash = 'adventures'; }}>{t('nav.adventures')}</button><button className="active">{t('listings.tab')}</button></div>
      <div className="listing-filters"><LocationPicker citiesOnly single label={t('listings.city')} value={cityId ? [cityId] : []} onChange={ids => setCityId(ids[0] ?? '')} />
        {cityId && <button className="text-button" onClick={() => setCityId('')}>{t('listings.anyCity')}</button>}
        <label>{t('listings.community')}<select value={communityId} onChange={event => setCommunityId(event.target.value)}><option value="">{t('listings.anyCommunity')}</option>{communities.map(item => <option value={item.id} key={item.id}>{item.name[getLocale()]}</option>)}</select></label>
        <div className="event-form-grid"><label>{t('listings.from')}<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>{t('listings.to')}<input type="date" min={from} value={to} onChange={event => setTo(event.target.value)} /></label></div></div></>}
    {error !== null && <p className="field-error" role="alert">{errorText(error)}</p>}
    {loading && !detail && !list.length && <p role="status">{t('common.loading')}</p>}
    {id && detail && <article className="paper-card event-detail">
      <div className="event-status">{t('listings.pick')}{detail.status === 'cancelled' ? ` · ${t('listings.cancelled')}` : Date.parse(detail.endsAt) <= Date.now() ? ` · ${t('listings.past')}` : ''}</div>
      <h1 dir="auto">{detail.title}</h1><p className="event-facts"><span><CalendarDays size={16} />{date(detail)} · {detail.timeZone}</span><span><MapPin size={16} />{venue(detail)}</span>{communityName(detail.communityId) && <span>✦ {communityName(detail.communityId)}</span>}</p>
      <p>{t('listings.organizer')}: {detail.organizerName}</p><Markdown content={detail.descriptionMarkdown} />
      <div className="event-actions"><a className="outline-button" href={detail.sourceUrl} target="_blank" rel="noopener noreferrer">{t('listings.source')}</a>
        <a className="text-button" href={detail.mapsUrl ?? (detail.place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${detail.place.name} ${detail.place.address}`)}` : undefined)} target="_blank" rel="noopener noreferrer">{t('events.openGoogleMaps')}</a>
        {detail.status === 'published' && Date.parse(detail.endsAt) > Date.now() && access?.canCreate && <button className="pixel-button small" onClick={() => setEditor(true)}><Plus size={16} />{t('listings.gather')}</button>}</div>
      {detail.status === 'published' && Date.parse(detail.endsAt) > Date.now() && access && !access.canCreate && <p className="field-hint">{t(access.hasRole ? 'events.createLimitReached' : 'events.createLocationDenied')}</p>}
    </article>}
    {id && detail && <section className="listing-parties"><h2>{t('listings.parties')}</h2>{detail.adventures.length ? <div className="adventure-list">{detail.adventures.map(adventure => <a className="paper-card adventure-card" href={`#adventures/${adventure.id}`} key={adventure.id}><div className="event-status">{adventure.participantCount}/{adventure.capacity}</div><h3>{adventure.title}</h3><p>{adventure.activitySummary}</p></a>)}</div> : <p>{t('listings.noParties')}</p>}</section>}
    {!id && !loading && !list.length && <p>{t('listings.empty')}</p>}
    {!id && <div className="adventure-list">{list.map(listing => <a className="paper-card adventure-card" href={`#listings/${listing.id}`} key={listing.id}><div className="event-status">{t('listings.pick')}</div><h2 dir="auto">{listing.title}</h2><p className="event-facts"><span><CalendarDays size={16} />{date(listing)}</span><span><MapPin size={16} />{venue(listing)}</span></p>{communityName(listing.communityId) && <p>✦ {communityName(listing.communityId)}</p>}</a>)}{nextOffset !== null && <button className="outline-button" disabled={loading} onClick={() => void more()}>{t('events.more')}</button>}</div>}
    {editor && detail && <EventEditor config={config} listing={detail} spokenLanguages={spokenLanguages} communityIds={communityIds} onClose={() => setEditor(false)} onSaved={(event: AdventureDetail) => { setEditor(false); location.hash = `adventures/${event.id}`; }} />}
  </section>;
}
