import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, CalendarDays, Globe2, Plus, RefreshCw, Users, LockKeyhole, Coins } from 'lucide-react';
import type { AppConfig, Profile } from '../../shared/schema.ts';
import type { DiscoveryPreferences } from '../../shared/discovery.ts';
import { wallTime, wallTimeToInstant, hasPublicLink, type Adventure, type AdventureDetail, type AdventureList, type EventFields, type CharacterConnection, type EventProfile, type EventCreationAccess } from '../../shared/events.ts';
import { googleMapsSearch } from '../../shared/event-links.ts';
import { communityAncestors } from '../../shared/communities.ts';
import { useCommunities } from '../community-catalog.tsx';
import { api, apiBlob, ApiError, hasTelegramSession } from '../api.ts';
import { t, errorText, getLocale, languageName, locationName, type TranslationKey } from '../i18n.ts';
import { DiscoverySettings, LanguagePicker, LocationPicker } from './Discovery.tsx';
import { Character } from './Character.tsx';
import { Markdown } from './Markdown.tsx';
import { ProfileCard } from './ProfileCard.tsx';
import { Modal } from './Modal.tsx';
import { PartyRoster } from './PartyRoster.tsx';
import { PlacePicker } from './PlacePicker.tsx';
function eventDate(event: Adventure) { return new Intl.DateTimeFormat(getLocale(), { timeZone: event.timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).formatRange(new Date(event.startsAt), new Date(event.endsAt)); }
const statusKey = (event: Adventure): TranslationKey => event.status === 'published' && Date.parse(event.startsAt) <= Date.now() ? 'events.started' : event.status === 'published' && !event.recruitmentOpen ? 'events.recruitmentClosed' : `events.${event.status}`;
const go = (id?: string) => { location.hash = id ? `adventures/${id}` : 'adventures'; };
function openBot(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
  const telegram = window.Telegram?.WebApp;
  if (telegram?.openTelegramLink) { event.preventDefault(); telegram.openTelegramLink(url); }
}
function EventFacts({ event }: { event: Adventure }) {
  const communities = useCommunities();
  const place = event.location.kind === 'online' ? event.onlinePlatform || t('events.online') : event.place
    ? [event.place.name, event.place.address, locationName(event.location.id, event.location.name)].join(' · ')
    : locationName(event.location.id, event.location.name);
  const community = communities.find(item => item.id === event.communityId);
  return <div className="event-facts"><span><CalendarDays size={16} />{eventDate(event)} · {event.timeZone}</span><span><Globe2 size={16} />{place} · {languageName(event.languageCode)}</span>{community && <span>✦ {community.name[getLocale()]}</span>}<span><Coins size={16} />{event.costEstimate}</span><span><Users size={16} />{t('events.seatsLeft', { count: Math.max(0, event.capacity - event.participantCount) })} · {t('events.count', { count: event.participantCount, capacity: event.capacity })}</span></div>;
}
function EventError({ error }: { error: unknown }) {
  const excerpts = error instanceof ApiError ? (error.details as { excerpts?: string[] } | undefined)?.excerpts : undefined;
  return error ? <div className="field-error" role="alert">{errorText(error)}{excerpts?.map((text, i) => <blockquote className="flagged-excerpt" key={i}>{text}</blockquote>)}</div> : null;
}
export function Adventures({ config, discovery, spokenLanguages, communityIds, onDiscovery }: { config: AppConfig; discovery: DiscoveryPreferences; spokenLanguages: string[]; communityIds: string[]; onDiscovery: (value: DiscoveryPreferences) => void }) {
  const [id, setId] = useState(location.hash.split('/')[1] ?? '');
  const [personId, setPersonId] = useState(location.hash.split('/')[3] ?? '');
  const [view, setView] = useState<'discover' | 'mine'>('discover');
  const [list, setList] = useState<AdventureList>({ events: [], nextOffset: null });
  const [creationAccess, setCreationAccess] = useState<EventCreationAccess | null>(null);
  const [detail, setDetail] = useState<AdventureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [editor, setEditor] = useState<AdventureDetail | 'new' | null>(null);
  const [application, setApplication] = useState(false);
  const [message, setMessage] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [connection, setConnection] = useState<CharacterConnection | null>(null);
  const [connectionPurpose, setConnectionPurpose] = useState<'chat' | 'contact' | null>(null);
  const [connectionMessage, setConnectionMessage] = useState('');
  const inTelegramMiniApp = Boolean(window.Telegram?.WebApp?.initData);
  const [confirmation, setConfirmation] = useState<{ title: TranslationKey; hint: TranslationKey; path: string; body: object; leave?: boolean } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    let previousId = location.hash.split('/')[1] ?? '';
    const change = () => {
      const nextId = location.hash.split('/')[1] ?? '';
      if (nextId !== previousId) setDetail(null);
      previousId = nextId;
      setId(nextId); setPersonId(location.hash.split('/')[3] ?? ''); setProfile(null); setConnection(null); setConnectionPurpose(null); setError(null);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const reload = useCallback(async (offset = 0, quiet = false) => {
    const current = ++generation.current;
    if (!quiet) setLoading(true);
    try {
      if (id) {
        const result = await api<{ event: AdventureDetail }>(`/events/${id}`);
        const character = personId ? await api<EventProfile>(`/events/${id}/profiles/${personId}`) : null;
        if (current === generation.current) { setDetail(result.event); if (character) { setProfile(character.profile); setConnection(character.connection); } }
      }
      else { const [result, access] = await Promise.all([api<AdventureList>(`/events?view=${view}&offset=${offset}`), api<EventCreationAccess>('/events/create-access')]); if (current === generation.current) { setList(old => offset ? { ...result, events: [...old.events, ...result.events] } : result); setCreationAccess(access); } }
      if (current === generation.current) setError(null);
    } catch (error) { if (current === generation.current) { setError(error); if (id) { setDetail(null); setProfile(null); setConnection(null); } } }
    finally { if (current === generation.current) setLoading(false); }
  }, [id, personId, view, discovery.revision]);
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
  function showCharacter(userId: string) { location.hash = `adventures/${id}/character/${userId}`; }
  async function requestConnection() {
    if (!connectionPurpose || !personId || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ connection: CharacterConnection }>(`/events/${id}/profiles/${personId}/connection`, { method: 'POST', body: { purpose: connectionPurpose, message: connectionMessage } });
      setConnection(result.connection); setConnectionPurpose(null); setConnectionMessage('');
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  async function setReminder(value: string) {
    if (!detail) return;
    setBusy(true); setError(null);
    try { setDetail((await api<{ event: AdventureDetail }>(`/events/${detail.id}/reminder`, { method: 'PUT', body: { minutesBefore: value ? Number(value) : null } })).event); }
    catch (error) { setError(error); } finally { setBusy(false); }
  }
  async function setRecruitment(open: boolean) {
    if (!detail) return;
    setBusy(true); setError(null);
    try { setDetail((await api<{ event: AdventureDetail }>(`/events/${detail.id}/recruitment`, { method: 'PUT', body: { open, revision: detail.revision } })).event); }
    catch (error) { setError(error); } finally { setBusy(false); }
  }
  async function downloadCalendar(eventId: string) {
    setBusy(true); setError(null);
    try {
      const file = await apiBlob(`/events/${eventId}/calendar.ics`);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = `questr-${eventId}.ics`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  const callLink = detail?.canChat && detail.location.kind === 'online' ? detail.meetingDetails : null;
  return <section className="adventures">
    <div className="adventure-heading">{id ? <button className="text-button" onClick={() => personId ? location.replace(`#adventures/${id}`) : go()}><ArrowLeft size={16} />{t(personId ? 'events.backToAdventure' : 'events.back')}</button> : <h1>{t('nav.adventures')}</h1>}{!personId && <div className="event-actions"><button className="icon-button" disabled={loading || busy} aria-label={t('events.refresh')} onClick={() => void reload()}><RefreshCw size={18} /></button>{!id && creationAccess?.hasRole && <button className="pixel-button small" disabled={!creationAccess.canCreate} onClick={() => setEditor('new')}><Plus size={16} />{t('events.create')}</button>}</div>}</div>
    {!id && creationAccess?.hasRole && creationAccess.budget && <p className="event-create-budget">{t('events.createBudget', { left: Math.max(0, creationAccess.budget.maxUses - creationAccess.budget.used), max: creationAccess.budget.maxUses, days: creationAccess.budget.windowDays })}</p>}
    {!id && <><div className="event-tabs"><button className={view === 'discover' ? 'active' : ''} onClick={() => setView('discover')}>{t('events.discover')}</button><button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}>{t('events.mine')}</button></div>{view === 'discover' && <DiscoverySettings initial={discovery} spokenLanguages={spokenLanguages} onSaved={onDiscovery} />}</>}
    {!editor && !confirmation && !application && !connectionPurpose && <EventError error={error} />}
    {personId ? profile ? <><ProfileCard profile={profile} />{config.authMode === 'telegram' && connection && (connection.status !== 'unavailable' || connection.botRequired) ? <div className="profile-connection">
      {connection.status === 'available' && (inTelegramMiniApp || !connection.botRequired) && <><button className="pixel-button small" onClick={() => { setConnectionPurpose('chat'); setConnectionMessage(''); }}>{t('events.requestChat')}</button><button className="outline-button small" onClick={() => { setConnectionPurpose('contact'); setConnectionMessage(''); }}>{t('events.requestContact')}</button></>}
      {connection.status === 'pending' && <><p role="status">{t('events.connectionPending')}</p><a className="text-button" href={connection.botUrl} onClick={event => openBot(event, event.currentTarget.href)} target="_blank" rel="noreferrer">{t('events.openPrivateChat')}</a></>}
      {connection.status === 'closed' && <p role="status">{t('events.connectionClosed')}</p>}
      {connection.status === 'incoming' && <a className="text-button" href={connection.botUrl} onClick={event => openBot(event, event.currentTarget.href)} target="_blank" rel="noreferrer">{t('events.connectionIncoming')}</a>}
      {connection.status === 'accepted' && <a className="pixel-button small" href={connection.botUrl} onClick={event => openBot(event, event.currentTarget.href)} target="_blank" rel="noreferrer">{t('events.openPrivateChat')}</a>}
      {connection.botRequired && !(inTelegramMiniApp && connection.status === 'available') && <a className="text-button" href="https://t.me/questr_game" onClick={event => openBot(event, event.currentTarget.href)} target="_blank" rel="noreferrer">{t('events.startBot')}</a>}
    </div> : null}</> : loading ? <p role="status">{t('common.loading')}</p> : null : loading && !detail ? <p role="status">{t('common.loading')}</p> : id && detail ? <>
      <article className="paper-card event-detail"><div className="event-status">{t(statusKey(detail))}</div><h1 dir="auto">{detail.title}</h1><p className="event-summary" dir="auto">{detail.activitySummary}</p><EventFacts event={detail} /><p className="event-experience"><strong>{t('events.experience')}:</strong> {detail.experienceNotes}</p>
        <button className="event-host text-button" disabled={busy} onClick={() => void showCharacter(detail.host.id)}><Character id={detail.host.avatarId} appearance={detail.host.avatarAppearance} />{t('events.host', { name: detail.host.displayName })}</button>
        <Markdown content={detail.descriptionMarkdown} />
        {(detail.meetingDetails || detail.meetingMapUrl) && <div className="meeting-details"><h2><LockKeyhole size={17} />{t(detail.location.kind === 'online' ? 'events.joiningDetails' : 'events.meetingPoint')}</h2>{detail.location.kind === 'online' && detail.meetingDetails ? <a href={detail.meetingDetails} target="_blank" rel="noreferrer">{detail.meetingDetails}</a> : detail.meetingDetails ? <p dir="auto">{detail.meetingDetails}</p> : null}{detail.location.kind === 'city' && <a className="text-button" href={detail.meetingMapUrl ?? googleMapsSearch(`${detail.meetingDetails}, ${detail.location.name}`)} target="_blank" rel="noreferrer">{t('events.openGoogleMaps')}</a>}<small>{t('events.private')}</small></div>}
        {!detail.isHost && detail.myStatus && <p className="membership-status" role="status">{t(`events.${detail.myStatus}`)}</p>}
        <div className="event-actions">
          {callLink && <a className="pixel-button" href={callLink} target="_blank" rel="noreferrer">{t('events.joinCall')}</a>}
          <a className="outline-button" href={`/api/events/${detail.id}/calendar.ics`} download onClick={event => { if (hasTelegramSession()) { event.preventDefault(); void downloadCalendar(detail.id); } }}>{t('events.calendar')}</a>
          {detail.canApply && <><button className="pixel-button" disabled={busy} onClick={() => void action('/applications', {})}>{t(detail.myStatus === 'withdrawn' ? 'events.reapply' : 'events.apply')}</button><button className="text-button" disabled={busy} onClick={() => { setError(null); setApplication(true); }}>{t('events.addNote')}</button></>}
          {detail.canChat && config.authMode === 'telegram' && <a className="pixel-button" href={detail.botUrl} onClick={event => openBot(event, detail.botUrl)} target="_blank" rel="noreferrer">{t('events.chat')}</a>}
          {!detail.canApply && !detail.myStatus && <span>{t(detail.participantCount >= detail.capacity ? 'events.full' : !detail.recruitmentOpen ? 'events.recruitmentClosed' : 'events.closed')}</span>}
          {!detail.isHost && ['pending', 'accepted'].includes(detail.myStatus ?? '') && <button className="outline-button" disabled={busy} onClick={() => setConfirmation({ title: 'events.confirmLeave', hint: 'events.accessEnds', path: '/leave', body: {}, leave: true })}>{t(detail.myStatus === 'pending' ? 'events.withdraw' : 'events.leave')}</button>}
          {detail.canEdit && <button className="outline-button" onClick={() => { setError(null); setEditor(detail); }}>{t('events.edit')}</button>}
          {detail.canEdit && <button className="outline-button" disabled={busy} onClick={() => void setRecruitment(!detail.recruitmentOpen)}>{t(detail.recruitmentOpen ? 'events.closeRecruitment' : 'events.openRecruitment')}</button>}
          {detail.isHost && detail.status === 'published' && <button className="text-button" disabled={busy} onClick={() => setConfirmation({ title: 'events.confirmCancel', hint: 'events.cancelHint', path: '/status', body: { status: 'cancelled', revision: detail.revision } })}>{t('events.cancel')}</button>}
          {detail.isHost && detail.status === 'published' && Date.parse(detail.startsAt) <= Date.now() && <button className="outline-button" disabled={busy} onClick={() => setConfirmation({ title: 'events.confirmComplete', hint: 'events.cancelHint', path: '/status', body: { status: 'completed', revision: detail.revision } })}>{t('events.complete')}</button>}
        </div>{detail.canChat && config.authMode === 'demo' && <p className="field-hint">{t('events.demoChat')}</p>}
        {detail.canChat && detail.status === 'published' && Date.parse(detail.startsAt) > Date.now() && config.authMode === 'telegram' && <label className="event-reminder">{t('events.remindMe')}<select value={detail.reminderMinutes ?? ''} disabled={busy} onChange={e => void setReminder(e.target.value)}><option value="">{t('events.reminderOff')}</option><option value="15">{t('events.reminder15')}</option><option value="60">{t('events.reminder60')}</option><option value="1440">{t('events.reminderDay')}</option></select></label>}
      </article>
      {!!detail.participants.length && <PartyRoster people={detail.participants} busy={busy} canManage={detail.canManage} onProfile={personId => void showCharacter(personId)} onRemove={personId => setConfirmation({ title: 'events.confirmRemove', hint: 'events.accessEnds', path: `/members/${personId}`, body: { action: 'remove' } })} />}
      {detail.canManage && <section className="applications"><h2>{t('events.applications')} <span>{detail.applications.length}</span></h2>{!detail.applications.length && <p className="field-hint">{t('events.noApplications')}</p>}{detail.applications.map(person => <article className="paper-card application" key={person.id}><button className="person-button" disabled={busy || person.unavailable} onClick={() => void showCharacter(person.id)}><Character id={person.avatarId} appearance={person.avatarAppearance} /><span>{person.displayName}{person.unavailable && <small className="unavailable-character">{t('events.unavailable')}</small>}</span></button>{person.applicationText && <p dir="auto">{person.applicationText}</p>}<div className="event-actions"><button className="pixel-button small" disabled={busy || person.unavailable || detail.participantCount >= detail.capacity || Date.parse(detail.startsAt) <= Date.now()} onClick={() => void action(`/members/${person.id}`, { action: 'accept' })}>{t('events.accept')}</button><button className="outline-button" disabled={busy} onClick={() => void action(`/members/${person.id}`, { action: 'decline' })}>{t('events.decline')}</button></div></article>)}</section>}
    </> : !id && <div className="adventure-list">{!list.events.length && <div className="events-empty"><Users size={28} /><h2>{t('events.empty')}</h2>{view === 'discover' && <p>{t('events.emptyHint')}</p>}</div>}{list.events.map(event => <button className="paper-card adventure-card" key={event.id} onClick={() => go(event.id)}><div className="event-status">{t(statusKey(event))}{event.myStatus && !event.isHost ? ` · ${t(`events.${event.myStatus}`)}` : ''}</div><h2 dir="auto">{event.title}</h2><p className="event-summary" dir="auto">{event.activitySummary}</p><EventFacts event={event} /><div className="card-host"><Character id={event.host.avatarId} appearance={event.host.avatarAppearance} /><span>{event.host.displayName}</span></div></button>)}{list.nextOffset !== null && <button className="outline-button" disabled={loading} onClick={() => void reload(list.nextOffset!)}>{t('events.more')}</button>}</div>}
    {editor && <EventEditor config={config} initial={editor === 'new' ? undefined : editor} spokenLanguages={spokenLanguages} communityIds={communityIds} onClose={() => setEditor(null)} onSaved={event => { setEditor(null); setDetail(event); setView('mine'); go(event.id); if (id === event.id) void reload(); }} />}
    {application && <Modal title={t('events.addNote')} onClose={() => { if (!busy) { setApplication(false); setError(null); } }}><form onSubmit={event => { event.preventDefault(); void action('/applications', { message }); }}><label htmlFor="application-message">{t('events.message')}</label><textarea id="application-message" minLength={3} maxLength={2000} rows={5} value={message} onChange={e => setMessage(e.target.value)} disabled={busy} autoFocus /><p className="field-hint">{t('events.firstMessageHint')}</p>{message.trim() && <p className="field-hint">{t(config.aiMode === 'openrouter' ? 'events.moderationLive' : 'events.moderation')}</p>}<EventError error={error} /><div className="modal-actions"><button className="pixel-button small" disabled={busy}>{t('events.send')}</button></div></form></Modal>}
    {connectionPurpose && <Modal title={t(connectionPurpose === 'contact' ? 'events.requestContact' : 'events.requestChat')} onClose={() => { if (!busy) { setConnectionPurpose(null); setError(null); } }}>{inTelegramMiniApp ? <><p>{t(connectionPurpose === 'contact' ? 'events.botContactInstruction' : 'events.botDmInstruction')}</p><div className="modal-actions"><a className="pixel-button small" href={connectionPurpose === 'contact' ? `https://t.me/questr_game?start=contact_${id.replaceAll('-', '').slice(0, 16)}_${personId.replaceAll('-', '')}` : connection?.botUrl ?? 'https://t.me/questr_game'} onClick={event => openBot(event, event.currentTarget.href)} target="_blank" rel="noreferrer">{t('events.openBot')}</a></div></> : <form onSubmit={event => { event.preventDefault(); void requestConnection(); }}><label htmlFor="connection-message">{t('events.connectionMessage')}</label><textarea id="connection-message" required minLength={3} maxLength={3000} rows={5} value={connectionMessage} onChange={e => setConnectionMessage(e.target.value)} disabled={busy} autoFocus /><p className="field-hint">{t(connectionPurpose === 'contact' ? 'events.contactHint' : 'events.chatHint')}</p><EventError error={error} /><div className="modal-actions"><button className="pixel-button small" disabled={busy}>{t('events.sendRequest')}</button></div></form>}</Modal>}
    {confirmation && <Modal title={t(confirmation.title)} onClose={() => { if (!busy) { setConfirmation(null); setError(null); } }}><p>{t(confirmation.hint)}</p><EventError error={error} /><div className="modal-actions"><button className="pixel-button small" disabled={busy} onClick={() => void action(confirmation.path, confirmation.body, confirmation.leave)}>{t('events.confirm')}</button></div></Modal>}
  </section>;
}
function EventEditor({ config, initial, spokenLanguages, communityIds, onClose, onSaved }: { config: AppConfig; initial?: AdventureDetail; spokenLanguages: string[]; communityIds: string[]; onClose: () => void; onSaved: (event: AdventureDetail) => void }) {
  const communities = useCommunities();
  const defaults = useRef<EventFields>({ title: initial?.title ?? '', activitySummary: '', descriptionMarkdown: initial?.descriptionMarkdown ?? '', costEstimate: initial?.costEstimate ?? t('events.defaultCost'), experienceNotes: initial?.experienceNotes ?? t('events.defaultExperience'), onlinePlatform: '', startsAt: initial?.startsAt ?? new Date(Date.now() + 86400000).toISOString(), endsAt: initial?.endsAt ?? new Date(Date.now() + 93600000).toISOString(), timeZone: initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, capacity: initial?.capacity ?? 6, languageCode: initial?.languageCode ?? spokenLanguages[0] ?? 'en', communityId: initial?.communityId ?? null, locationId: initial?.location.id ?? '', placeId: initial?.place?.id ?? null, meetingDetails: initial?.meetingDetails ?? '', meetingMapUrl: initial?.meetingMapUrl ?? '' });
  const allowedCommunityIds = new Set(communityIds.flatMap(id => communityAncestors(communities, id)));
  const [fields, setFields] = useState(defaults.current);
  const initialWall = useRef({ start: wallTime(defaults.current.startsAt, defaults.current.timeZone), end: wallTime(defaults.current.endsAt, defaults.current.timeZone) });
  const [startDate, setStartDate] = useState(initialWall.current.start.slice(0, 10));
  const [startClock, setStartClock] = useState(initialWall.current.start.slice(11, 16));
  const [endDate, setEndDate] = useState(initialWall.current.end.slice(0, 10));
  const [endClock, setEndClock] = useState(initialWall.current.end.slice(11, 16));
  const [showEndDate, setShowEndDate] = useState(initialWall.current.start.slice(0, 10) !== initialWall.current.end.slice(0, 10));
  const [focusPlace, setFocusPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [discard, setDiscard] = useState(false);
  const [locationAccess, setLocationAccess] = useState<EventCreationAccess | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(!!initial);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const privateMeeting = useRef({
    offlineLocationId: initial?.location.kind === 'city' ? initial.location.id : '',
    offlinePlaceId: initial?.location.kind === 'city' ? initial.place?.id ?? null : null,
    offlineDetails: initial?.location.kind === 'city' ? initial.meetingDetails ?? '' : '',
    offlineMapUrl: initial?.location.kind === 'city' ? initial.meetingMapUrl ?? '' : '',
    onlineLink: initial?.location.kind === 'online' ? initial.meetingDetails ?? '' : '',
  });
  const requestId = useRef(crypto.randomUUID());
  const zones = [...new Set(['UTC', fields.timeZone, ...Intl.supportedValuesOf('timeZone')])].sort();
  const change = (patch: Partial<EventFields>) => setFields(old => ({ ...old, ...patch }));
  const startWall = `${startDate}T${startClock}`;
  const endWall = `${endDate}T${endClock}`;
  function moveStart(nextDate: string, nextClock: string) {
    const before = Date.parse(`${startWall}:00Z`);
    const after = Date.parse(`${nextDate}T${nextClock}:00Z`);
    const oldEnd = Date.parse(`${endWall}:00Z`);
    setStartDate(nextDate); setStartClock(nextClock);
    if (Number.isFinite(before) && Number.isFinite(after) && Number.isFinite(oldEnd)) {
      const shiftedEnd = new Date(oldEnd + after - before).toISOString().slice(0, 16);
      setEndDate(shiftedEnd.slice(0, 10)); setEndClock(shiftedEnd.slice(11, 16));
      if (shiftedEnd.slice(0, 10) !== nextDate) setShowEndDate(true);
    }
  }
  function changeEndClock(nextClock: string) {
    setEndClock(nextClock);
    if (endDate === startDate && nextClock && nextClock <= startClock) {
      const nextDay = Date.parse(`${startDate}T00:00:00Z`) + 86400000;
      if (Number.isFinite(nextDay)) { setEndDate(new Date(nextDay).toISOString().slice(0, 10)); setShowEndDate(true); }
    }
  }
  function changeLocation(nextId: string) {
    setFocusPlace(Boolean(nextId && nextId !== 'online'));
    const saved = privateMeeting.current;
    if (fields.locationId === 'online') saved.onlineLink = fields.meetingDetails;
    else if (fields.locationId) {
      saved.offlineLocationId = fields.locationId;
      saved.offlinePlaceId = fields.placeId;
      saved.offlineDetails = fields.meetingDetails;
      saved.offlineMapUrl = fields.meetingMapUrl;
    }
    if (!nextId) { change({ locationId: '', placeId: null, meetingDetails: '', meetingMapUrl: '' }); return; }
    if (nextId === 'online') change({ locationId: nextId, placeId: null, meetingDetails: saved.onlineLink, meetingMapUrl: '' });
    else {
      if (nextId !== saved.offlineLocationId) {
        saved.offlineLocationId = nextId; saved.offlinePlaceId = null; saved.offlineDetails = ''; saved.offlineMapUrl = '';
      }
      change({ locationId: nextId, placeId: saved.offlinePlaceId, meetingDetails: saved.offlineDetails, meetingMapUrl: saved.offlineMapUrl });
    }
  }
  useEffect(() => {
    if (initial || !fields.locationId) { setLocationAccess(null); return; }
    let active = true;
    setLocationAccess(null);
    void api<EventCreationAccess>(`/events/create-access?locationId=${encodeURIComponent(fields.locationId)}`)
      .then(access => { if (active) setLocationAccess(access); })
      .catch(problem => { if (active) setError(problem); });
    return () => { active = false; };
  }, [fields.locationId, initial]);
  function close() { if (busy) return; if (JSON.stringify(fields) !== JSON.stringify(defaults.current) || startWall !== initialWall.current.start || endWall !== initialWall.current.end) setDiscard(true); else onClose(); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      let instant: string, endInstant: string;
      try { instant = wallTimeToInstant(startWall, fields.timeZone); endInstant = wallTimeToInstant(endWall, fields.timeZone); } catch (error) { throw { code: error instanceof Error ? error.message : 'EVENT_TIME_INVALID' }; }
      if (Date.parse(endInstant) <= Date.parse(instant)) throw { code: 'EVENT_END_INVALID' };
      if (!fields.locationId) throw { code: 'EVENT_LOCATION_INVALID' };
      if (!initial && !locationAccess?.canCreate) throw { code: 'PERMISSION_DENIED' };
      const body = { ...fields, costEstimate: fields.costEstimate.trim() || t('events.defaultCost'), experienceNotes: fields.experienceNotes.trim() || t('events.defaultExperience'), startsAt: instant, endsAt: endInstant, ...(initial ? { revision: initial.revision } : { requestId: requestId.current }) };
      const result = await api<{ event: AdventureDetail }>(initial ? `/events/${initial.id}` : '/events', { method: initial ? 'PUT' : 'POST', body });
      onSaved(result.event);
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  return <Modal wide title={t(initial ? 'events.edit' : 'events.create')} onClose={close}><form className="event-form" onSubmit={event => void submit(event)}><fieldset disabled={busy}>
    <label htmlFor="event-title">{t('events.title')}</label><input id="event-title" required minLength={3} maxLength={160} value={fields.title} onChange={e => change({ title: e.target.value })} autoFocus />
    <label htmlFor="event-description">{t('events.description')}</label><textarea id="event-description" required minLength={10} maxLength={12000} rows={5} value={fields.descriptionMarkdown} onChange={e => change({ descriptionMarkdown: e.target.value })} /><p className="field-hint">{t('events.descriptionHint')}</p>{[fields.title, fields.descriptionMarkdown, fields.costEstimate, fields.experienceNotes].some(hasPublicLink) && <p className="field-error">{t('events.publicCallWarning')}</p>}
    <div className="event-date"><label htmlFor="event-date">{t('events.date')}</label><input id="event-date" type="date" value={startDate} onChange={e => moveStart(e.target.value, startClock)} required /></div>
    <div className="event-time-range"><div><label htmlFor="event-start-time">{t('events.start')}</label><input id="event-start-time" type="time" value={startClock} onChange={e => moveStart(startDate, e.target.value)} required /></div><div><label htmlFor="event-end-time">{t('events.end')}</label><input id="event-end-time" type="time" value={endClock} onChange={e => changeEndClock(e.target.value)} required /></div></div>
    {showEndDate ? <div className="event-end-date"><label htmlFor="event-end-date">{t('events.endDate')}</label><input id="event-end-date" type="date" min={startDate} value={endDate} onChange={e => setEndDate(e.target.value)} required /></div> : <button type="button" className="text-button event-end-date-toggle" onClick={() => { const nextDay = Date.parse(`${startDate}T00:00:00Z`) + 86400000; if (Number.isFinite(nextDay)) setEndDate(new Date(nextDay).toISOString().slice(0, 10)); setShowEndDate(true); }}>{t('events.differentEndDate')}</button>}
    <LocationPicker single collapseWhenSelected label={t('events.cityOrOnline')} placeholder={t('events.searchLocation')} value={fields.locationId ? [fields.locationId] : []} onChange={ids => changeLocation(ids[0] ?? '')} />
    {!initial && fields.locationId && locationAccess && !locationAccess.canCreate && <p className="field-error" role="alert">{t(locationAccess.hasRole ? 'events.createLimitReached' : 'events.createLocationDenied')}</p>}
    {fields.locationId && fields.locationId !== 'online' && <PlacePicker key={fields.locationId} cityId={fields.locationId} placeId={fields.placeId} meetingMapUrl={fields.meetingMapUrl} selected={initial?.place} googleKey={config.googleMapsBrowserKey} focusOnMount={focusPlace} onPick={pick => {
      if (pick?.kind === 'saved') change({ placeId: pick.id, meetingMapUrl: '' });
      else if (pick?.kind === 'google') change({ placeId: null, meetingMapUrl: pick.mapUrl });
      else change({ placeId: null, meetingMapUrl: '' });
    }} />}
    <div className="event-form-grid"><div><LanguagePicker single collapseWhenSelected label={t('events.language')} value={[fields.languageCode]} onChange={codes => { if (codes[0]) change({ languageCode: codes[0] }); }} /></div><div><label htmlFor="event-capacity">{t('events.capacity')}</label><input id="event-capacity" type="number" min={2} max={50} required value={fields.capacity} onChange={e => change({ capacity: Number(e.target.value) })} /><p className="field-hint">{t('events.capacityHint')}</p></div></div>
    {allowedCommunityIds.size > 0 && <><label htmlFor="event-community">{t('events.community')}</label><select id="event-community" value={fields.communityId ?? ''} disabled={!!initial} onChange={event => change({ communityId: event.target.value || null })}><option value="">{t('events.everyone')}</option>{communities.filter(community => allowedCommunityIds.has(community.id)).map(community => <option value={community.id} key={community.id}>{community.name[getLocale()]}</option>)}</select><p className="field-hint">{t('events.communityHint')}</p></>}
    <details className="event-options" ref={optionsRef} open={optionsOpen} onToggle={event => setOptionsOpen(event.currentTarget.open)}><summary>{t('events.moreOptions')}<small>{t('events.moreOptionsHint', { cost: fields.costEstimate.trim() || t('events.defaultCost'), experience: fields.experienceNotes.trim() || t('events.defaultExperience'), zone: fields.timeZone })}</small></summary>
    <div className="event-form-grid"><div><label htmlFor="event-cost">{t('events.cost')}</label><input id="event-cost" maxLength={120} value={fields.costEstimate} onChange={e => change({ costEstimate: e.target.value })} placeholder={t('events.costPlaceholder')} /></div><div><label htmlFor="event-experience">{t('events.experience')}</label><input id="event-experience" maxLength={240} value={fields.experienceNotes} onChange={e => change({ experienceNotes: e.target.value })} placeholder={t('events.experiencePlaceholder')} /></div></div>
    <label htmlFor="event-zone">{t('events.zone')}</label><select id="event-zone" value={fields.timeZone} onChange={e => change({ timeZone: e.target.value })}>{zones.map(zone => <option key={zone}>{zone}</option>)}</select>
    <label htmlFor="event-meeting">{t(fields.locationId === 'online' ? 'events.privateLink' : 'events.privatePoint')}</label>{fields.locationId === 'online' ? <input id="event-meeting" type="url" maxLength={2000} value={fields.meetingDetails} onChange={e => change({ meetingDetails: e.target.value })} onInvalid={() => { if (optionsRef.current) optionsRef.current.open = true; }} placeholder="https://…" /> : <textarea id="event-meeting" maxLength={2000} rows={2} value={fields.meetingDetails} onChange={e => change({ meetingDetails: e.target.value })} />}<p className="field-hint">{t(fields.locationId === 'online' ? 'events.privateLinkHint' : 'events.privatePointHint')}</p>
    </details>
    </fieldset><p className="field-hint">{t(config.aiMode === 'openrouter' ? 'events.moderationLive' : 'events.moderation')}</p><EventError error={error} /><div className="modal-actions"><button className="pixel-button" disabled={busy || !initial && !!fields.locationId && !locationAccess?.canCreate}>{t(busy ? 'common.saving' : initial ? 'events.save' : 'events.publish')}</button></div></form>
    {discard && <Modal title={t('events.discard')} onClose={() => setDiscard(false)}><p>{t('events.discardHint')}</p><div className="modal-actions"><button className="pixel-button small" onClick={onClose}>{t('events.confirm')}</button></div></Modal>}
  </Modal>;
}
