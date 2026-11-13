import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarDays, Globe2, Plus, RefreshCw, Users, LockKeyhole } from 'lucide-react';
import type { AppConfig, Profile } from '../../shared/schema.ts';
import { languages, type DiscoveryPreferences } from '../../shared/discovery.ts';
import { wallTime, wallTimeToInstant, type Adventure, type AdventureDetail, type AdventureList, type EventFields } from '../../shared/events.ts';
import { googleMapsSearch, zoomLink } from '../../shared/event-links.ts';
import { api, ApiError } from '../api.ts';
import { t, errorText, type TranslationKey } from '../i18n.ts';
import { DiscoverySettings, LocationPicker } from './Discovery.tsx';
import { Character } from './Character.tsx';
import { Markdown } from './Markdown.tsx';
import { ProfileCard } from './ProfileCard.tsx';
import { Modal } from './Modal.tsx';
import { GooglePlacePicker } from './GooglePlacePicker.tsx';
const language = (code: string) => languages.find(l => l.code === code)?.label ?? code;
function eventDate(event: Adventure) { return new Intl.DateTimeFormat('en', { timeZone: event.timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).formatRange(new Date(event.startsAt), new Date(event.endsAt)); }
const statusKey = (event: Adventure): TranslationKey => event.status === 'published' && Date.parse(event.startsAt) <= Date.now() ? 'events.started' : `events.${event.status}`;
const go = (id?: string) => { location.hash = id ? `adventures/${id}` : 'adventures'; };
function EventFacts({ event }: { event: Adventure }) {
  return <div className="event-facts"><span><CalendarDays size={16} />{eventDate(event)} · {event.timeZone}</span><span><Globe2 size={16} />{event.location.name}{event.location.countryName ? `, ${event.location.countryName}` : ''} · {language(event.languageCode)}</span><span><Users size={16} />{t('events.count', { count: event.participantCount, capacity: event.capacity })}</span></div>;
}
function EventError({ error }: { error: unknown }) {
  const excerpts = error instanceof ApiError ? (error.details as { excerpts?: string[] } | undefined)?.excerpts : undefined;
  return error ? <div className="field-error" role="alert">{errorText(error)}{excerpts?.map((text, i) => <blockquote className="flagged-excerpt" key={i}>{text}</blockquote>)}</div> : null;
}
export function Adventures({ config, discovery, spokenLanguages, onDiscovery }: { config: AppConfig; discovery: DiscoveryPreferences; spokenLanguages: string[]; onDiscovery: (value: DiscoveryPreferences) => void }) {
  const [id, setId] = useState(location.hash.split('/')[1] ?? '');
  const [view, setView] = useState<'discover' | 'mine'>('discover');
  const [list, setList] = useState<AdventureList>({ events: [], nextOffset: null });
  const [detail, setDetail] = useState<AdventureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editor, setEditor] = useState<AdventureDetail | 'new' | null>(null);
  const [application, setApplication] = useState(false);
  const [message, setMessage] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [confirmation, setConfirmation] = useState<{ title: TranslationKey; hint: TranslationKey; path: string; body: object; leave?: boolean } | null>(null);
  const generation = useRef(0);
  useEffect(() => { const change = () => { setId(location.hash.split('/')[1] ?? ''); setDetail(null); setError(null); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const reload = useCallback(async (offset = 0, quiet = false) => {
    const current = ++generation.current;
    if (!quiet) setLoading(true);
    try {
      if (id) { const result = await api<{ event: AdventureDetail }>(`/events/${id}`); if (current === generation.current) setDetail(result.event); }
      else { const result = await api<AdventureList>(`/events?view=${view}&offset=${offset}`); if (current === generation.current) setList(old => offset ? { ...result, events: [...old.events, ...result.events] } : result); }
      if (current === generation.current) setError(null);
    } catch (error) { if (current === generation.current) { setError(error); if (id) { setDetail(null); setProfile(null); } } }
    finally { if (current === generation.current) setLoading(false); }
  }, [id, view, discovery.revision]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden && !busy && !editor && !application && !confirmation) void reload(0, true); };
    const timer = setInterval(refresh, 20000); window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [reload, busy, editor, application, confirmation]);
  async function action(path: string, body: object, leave = false) {
    if (busy) return;
    generation.current++; setLoading(false);
    setBusy(true); setError(null);
    try {
      const result = await api<{ event: AdventureDetail | null }>(`/events/${id}${path}`, { method: 'POST', body });
      setConfirmation(null); setApplication(false); setMessage(''); setDetail(result.event);
      if (leave) { setView('mine'); go(); }
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  async function showCharacter(userId: string) {
    setBusy(true); setError(null);
    try { setProfile((await api<{ profile: Profile }>(`/events/${id}/profiles/${userId}`)).profile); }
    catch (error) { setError(error); } finally { setBusy(false); }
  }
  async function setReminder(value: string) {
    if (!detail) return;
    setBusy(true); setError(null);
    try { setDetail((await api<{ event: AdventureDetail }>(`/events/${detail.id}/reminder`, { method: 'PUT', body: { minutesBefore: value ? Number(value) : null } })).event); }
    catch (error) { setError(error); } finally { setBusy(false); }
  }
  const callLink = detail?.canChat ? zoomLink(detail.descriptionMarkdown) ?? zoomLink(detail.meetingDetails ?? '') : null;
  return <section className="adventures">
    <div className="adventure-heading">{id ? <button className="text-button" onClick={() => go()}><ArrowLeft size={16} />{t('events.back')}</button> : <h1>{t('nav.adventures')}</h1>}<div className="event-actions"><button className="icon-button" disabled={loading || busy} aria-label={t('events.refresh')} onClick={() => void reload()}><RefreshCw size={18} /></button>{!id && <button className="pixel-button small" onClick={() => setEditor('new')}><Plus size={16} />{t('events.create')}</button>}</div></div>
    {!id && <><div className="event-tabs"><button className={view === 'discover' ? 'active' : ''} onClick={() => setView('discover')}>{t('events.discover')}</button><button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>{t('events.mine')}</button></div>{view === 'discover' && <DiscoverySettings initial={discovery} spokenLanguages={spokenLanguages} onSaved={onDiscovery} />}</>}
    {!editor && !confirmation && !application && <EventError error={error} />}
    {loading && !detail ? <p role="status">{t('common.loading')}</p> : id && detail ? <>
      <article className="paper-card event-detail"><div className="event-status">{t(statusKey(detail))}</div><h1 dir="auto">{detail.title}</h1><EventFacts event={detail} />
        <button className="event-host text-button" disabled={busy} onClick={() => void showCharacter(detail.host.id)}><Character id={detail.host.avatarId} />{t('events.host', { name: detail.host.displayName })}</button>
        <Markdown content={detail.descriptionMarkdown} />
        {detail.meetingDetails && <div className="meeting-details"><h2><LockKeyhole size={17} />{t(detail.location.kind === 'online' ? 'events.joiningDetails' : 'events.meetingPoint')}</h2>{detail.location.kind === 'online' ? <a href={detail.meetingDetails} target="_blank" rel="noreferrer">{detail.meetingDetails}</a> : <p dir="auto">{detail.meetingDetails}</p>}{detail.location.kind === 'city' && <a className="text-button" href={detail.meetingMapUrl ?? googleMapsSearch(`${detail.meetingDetails}, ${detail.location.name}`)} target="_blank" rel="noreferrer">{t('events.openGoogleMaps')}</a>}<small>{t('events.private')}</small></div>}
        {!detail.isHost && detail.myStatus && <p className="membership-status" role="status">{t(`events.${detail.myStatus}`)}</p>}
        <div className="event-actions">
          {callLink && <a className="pixel-button" href={callLink} target="_blank" rel="noreferrer">{t('events.joinZoom')}</a>}
          <a className="outline-button" href={`/api/events/${detail.id}/calendar.ics`} download>{t('events.calendar')}</a>
          {detail.canApply && (config.authMode === 'telegram' ? <a className="pixel-button" href={detail.botUrl} target="_blank" rel="noreferrer">{t('events.applyBot')}</a> : <button className="pixel-button" onClick={() => { setError(null); setApplication(true); }}>{t('events.apply')}</button>)}
          {detail.canChat && config.authMode === 'telegram' && <a className="pixel-button" href={detail.botUrl} target="_blank" rel="noreferrer">{t('events.chat')}</a>}
          {!detail.canApply && !detail.myStatus && <span>{t(detail.participantCount >= detail.capacity ? 'events.full' : 'events.closed')}</span>}
          {!detail.isHost && ['pending', 'accepted'].includes(detail.myStatus ?? '') && <button className="outline-button" disabled={busy} onClick={() => setConfirmation({ title: 'events.confirmLeave', hint: 'events.accessEnds', path: '/leave', body: {}, leave: true })}>{t(detail.myStatus === 'pending' ? 'events.withdraw' : 'events.leave')}</button>}
          {detail.canEdit && <button className="outline-button" onClick={() => { setError(null); setEditor(detail); }}>{t('events.edit')}</button>}
          {detail.isHost && detail.status === 'published' && <button className="text-button" disabled={busy} onClick={() => setConfirmation({ title: 'events.confirmCancel', hint: 'events.cancelHint', path: '/status', body: { status: 'cancelled', revision: detail.revision } })}>{t('events.cancel')}</button>}
          {detail.isHost && detail.status === 'published' && Date.parse(detail.startsAt) <= Date.now() && <button className="outline-button" disabled={busy} onClick={() => setConfirmation({ title: 'events.confirmComplete', hint: 'events.cancelHint', path: '/status', body: { status: 'completed', revision: detail.revision } })}>{t('events.complete')}</button>}
        </div>{detail.canChat && config.authMode === 'demo' && <p className="field-hint">{t('events.demoChat')}</p>}
        {detail.canChat && detail.status === 'published' && Date.parse(detail.startsAt) > Date.now() && config.authMode === 'telegram' && <label className="event-reminder">{t('events.remindMe')}<select value={detail.reminderMinutes ?? ''} disabled={busy} onChange={e => void setReminder(e.target.value)}><option value="">{t('events.reminderOff')}</option><option value="15">{t('events.reminder15')}</option><option value="60">{t('events.reminder60')}</option><option value="1440">{t('events.reminderDay')}</option></select></label>}
      </article>
      {!!detail.participants.length && <section className="party-section"><h2>{t('events.party')}</h2><div className="party-grid">{detail.participants.map(person => <div className="party-person" key={person.id}><button className="person-button" disabled={busy || person.unavailable} onClick={() => void showCharacter(person.id)}><Character id={person.avatarId} /><span>{person.displayName}{person.unavailable && <small className="unavailable-character">{t('events.unavailable')}</small>}</span></button>{detail.canManage && person.role !== 'host' && <button className="text-button" disabled={busy} onClick={() => setConfirmation({ title: 'events.confirmRemove', hint: 'events.accessEnds', path: `/members/${person.id}`, body: { action: 'remove' } })}>{t('events.remove')}</button>}</div>)}</div></section>}
      {detail.canManage && <section className="applications"><h2>{t('events.applications')} <span>{detail.applications.length}</span></h2>{!detail.applications.length && <p className="field-hint">{t('events.noApplications')}</p>}{detail.applications.map(person => <article className="paper-card application" key={person.id}><button className="person-button" disabled={busy || person.unavailable} onClick={() => void showCharacter(person.id)}><Character id={person.avatarId} /><span>{person.displayName}{person.unavailable && <small className="unavailable-character">{t('events.unavailable')}</small>}</span></button><p dir="auto">{person.applicationText}</p><div className="event-actions"><button className="pixel-button small" disabled={busy || person.unavailable || detail.participantCount >= detail.capacity || Date.parse(detail.startsAt) <= Date.now()} onClick={() => void action(`/members/${person.id}`, { action: 'accept' })}>{t('events.accept')}</button><button className="outline-button" disabled={busy} onClick={() => void action(`/members/${person.id}`, { action: 'decline' })}>{t('events.decline')}</button></div></article>)}</section>}
    </> : !id && <div className="adventure-list">{!list.events.length && <div className="events-empty"><Users size={28} /><h2>{t('events.empty')}</h2>{view === 'discover' && <p>{t('events.emptyHint')}</p>}</div>}{list.events.map(event => <button className="paper-card adventure-card" key={event.id} onClick={() => go(event.id)}><div className="event-status">{t(statusKey(event))}{event.myStatus && !event.isHost ? ` · ${t(`events.${event.myStatus}`)}` : ''}</div><h2 dir="auto">{event.title}</h2><EventFacts event={event} /><div className="card-host"><Character id={event.host.avatarId} /><span>{event.host.displayName}</span></div></button>)}{list.nextOffset !== null && <button className="outline-button" disabled={loading} onClick={() => void reload(list.nextOffset!)}>{t('events.more')}</button>}</div>}
    {editor && <EventEditor config={config} initial={editor === 'new' ? undefined : editor} spokenLanguages={spokenLanguages} onClose={() => setEditor(null)} onSaved={event => { setEditor(null); setDetail(event); setView('mine'); go(event.id); if (id === event.id) void reload(); }} />}
    {application && <Modal title={t('events.apply')} onClose={() => { if (!busy) { setApplication(false); setError(null); } }}><form onSubmit={event => { event.preventDefault(); void action('/applications', { message }); }}><label htmlFor="application-message">{t('events.message')}</label><textarea id="application-message" required minLength={3} maxLength={2000} rows={5} value={message} onChange={e => setMessage(e.target.value)} disabled={busy} autoFocus /><p className="field-hint">{t('events.requestHint')}</p><p className="field-hint">{t(config.aiMode === 'openrouter' ? 'events.moderationLive' : 'events.moderation')}</p><EventError error={error} /><div className="modal-actions"><button className="pixel-button small" disabled={busy}>{t('events.send')}</button></div></form></Modal>}
    {confirmation && <Modal title={t(confirmation.title)} onClose={() => { if (!busy) { setConfirmation(null); setError(null); } }}><p>{t(confirmation.hint)}</p><EventError error={error} /><div className="modal-actions"><button className="pixel-button small" disabled={busy} onClick={() => void action(confirmation.path, confirmation.body, confirmation.leave)}>{t('events.confirm')}</button></div></Modal>}
    {profile && <Modal wide title={t('events.profile')} onClose={() => setProfile(null)}><ProfileCard profile={profile} /></Modal>}
  </section>;
}
function EventEditor({ config, initial, spokenLanguages, onClose, onSaved }: { config: AppConfig; initial?: AdventureDetail; spokenLanguages: string[]; onClose: () => void; onSaved: (event: AdventureDetail) => void }) {
  const defaults = useRef<EventFields>({ title: initial?.title ?? '', descriptionMarkdown: initial?.descriptionMarkdown ?? '', startsAt: initial?.startsAt ?? new Date(Date.now() + 86400000).toISOString(), endsAt: initial?.endsAt ?? new Date(Date.now() + 93600000).toISOString(), timeZone: initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, capacity: initial?.capacity ?? 6, languageCode: initial?.languageCode ?? spokenLanguages[0] ?? 'en', locationId: initial?.location.id ?? '', meetingDetails: initial?.meetingDetails ?? '', meetingMapUrl: initial?.meetingMapUrl ?? '' });
  const [fields, setFields] = useState(defaults.current);
  const [localTime, setLocalTime] = useState(wallTime(defaults.current.startsAt, defaults.current.timeZone));
  const [localEndTime, setLocalEndTime] = useState(wallTime(defaults.current.endsAt, defaults.current.timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [discard, setDiscard] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const zones = [...new Set(['UTC', fields.timeZone, ...Intl.supportedValuesOf('timeZone')])].sort();
  const change = (patch: Partial<EventFields>) => setFields(old => ({ ...old, ...patch }));
  const pickedPlace = useCallback(({ mapUrl }: { mapUrl: string }) => change({ meetingMapUrl: mapUrl }), []);
  function close() { if (busy) return; if (JSON.stringify(fields) !== JSON.stringify(defaults.current) || localTime !== wallTime(defaults.current.startsAt, defaults.current.timeZone) || localEndTime !== wallTime(defaults.current.endsAt, defaults.current.timeZone)) setDiscard(true); else onClose(); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      let instant: string, endInstant: string;
      try { instant = wallTimeToInstant(localTime, fields.timeZone); endInstant = wallTimeToInstant(localEndTime, fields.timeZone); } catch (error) { throw { code: error instanceof Error ? error.message : 'EVENT_TIME_INVALID' }; }
      if (Date.parse(endInstant) <= Date.parse(instant)) throw { code: 'EVENT_END_INVALID' };
      if (!fields.locationId) throw { code: 'EVENT_LOCATION_INVALID' };
      const body = { ...fields, startsAt: instant, endsAt: endInstant, ...(initial ? { revision: initial.revision } : { requestId: requestId.current }) };
      const result = await api<{ event: AdventureDetail }>(initial ? `/events/${initial.id}` : '/events', { method: initial ? 'PUT' : 'POST', body });
      onSaved(result.event);
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  return <Modal wide title={t(initial ? 'events.edit' : 'events.create')} onClose={close}><form className="event-form" onSubmit={event => void submit(event)}><fieldset disabled={busy}>
    <label htmlFor="event-title">{t('events.title')}</label><input id="event-title" required minLength={3} maxLength={160} value={fields.title} onChange={e => change({ title: e.target.value })} autoFocus />
    <label htmlFor="event-description">{t('events.description')}</label><textarea id="event-description" required minLength={10} maxLength={12000} rows={5} value={fields.descriptionMarkdown} onChange={e => change({ descriptionMarkdown: e.target.value })} /><p className="field-hint">{t('events.descriptionHint')}</p>{zoomLink(fields.descriptionMarkdown) && <p className="field-error">{t('events.publicCallWarning')}</p>}
    <div className="event-form-grid"><div><label htmlFor="event-when">{t('events.start')}</label><input id="event-when" type="datetime-local" value={localTime} onChange={e => { const old = Date.parse(`${localTime}:00Z`), next = Date.parse(`${e.target.value}:00Z`); if (Number.isFinite(old) && Number.isFinite(next)) setLocalEndTime(new Date(Date.parse(`${localEndTime}:00Z`) + next - old).toISOString().slice(0,16)); setLocalTime(e.target.value); }} required /></div><div><label htmlFor="event-end">{t('events.end')}</label><input id="event-end" type="datetime-local" value={localEndTime} onChange={e => setLocalEndTime(e.target.value)} required /></div></div>
    <label htmlFor="event-zone">{t('events.zone')}</label><select id="event-zone" value={fields.timeZone} onChange={e => change({ timeZone: e.target.value })}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select>
    <LocationPicker single value={fields.locationId ? [fields.locationId] : []} onChange={ids => change({ locationId: ids[0] ?? '' })} />
    <div className="event-form-grid"><div><label htmlFor="event-language">{t('events.language')}</label><select id="event-language" value={fields.languageCode} onChange={e => change({ languageCode: e.target.value })}>{languages.map(l => <option key={l.code} value={l.code}>{l.label} · {l.native}</option>)}</select></div><div><label htmlFor="event-capacity">{t('events.capacity')}</label><input id="event-capacity" type="number" min={2} max={50} required value={fields.capacity} onChange={e => change({ capacity: Number(e.target.value) })} /><p className="field-hint">{t('events.capacityHint')}</p></div></div>
    <label htmlFor="event-meeting">{t(fields.locationId === 'online' ? 'events.privateLink' : 'events.privatePoint')}</label><textarea id="event-meeting" required minLength={3} maxLength={2000} rows={3} value={fields.meetingDetails} onChange={e => change({ meetingDetails: e.target.value, meetingMapUrl: '' })} /><p className="field-hint">{t('events.private')}</p>
    {fields.locationId && fields.locationId !== 'online' && <><div className="event-map-actions">{config.googleMapsBrowserKey && <GooglePlacePicker keyValue={config.googleMapsBrowserKey} onPick={pickedPlace} />}<a className="text-button" href={googleMapsSearch(`${fields.meetingDetails || ''} ${initial?.location.name ?? ''}`.trim() || 'meeting point')} target="_blank" rel="noreferrer">{t('events.findGoogleMaps')}</a></div><label htmlFor="event-map-url">{t('events.mapLink')}</label><input id="event-map-url" type="url" value={fields.meetingMapUrl} onChange={e => change({ meetingMapUrl: e.target.value })} placeholder="https://maps.app.goo.gl/…" /><p className="field-hint">{t('events.mapLinkHint')}</p></>}
    </fieldset><p className="field-hint">{t(config.aiMode === 'openrouter' ? 'events.moderationLive' : 'events.moderation')}</p><EventError error={error} /><div className="modal-actions"><button className="pixel-button" disabled={busy}>{t(busy ? 'common.saving' : initial ? 'events.save' : 'events.publish')}</button></div></form>
    {discard && <Modal title={t('events.discard')} onClose={() => setDiscard(false)}><p>{t('events.discardHint')}</p><div className="modal-actions"><button className="pixel-button small" onClick={onClose}>{t('events.confirm')}</button></div></Modal>}
  </Modal>;
}
