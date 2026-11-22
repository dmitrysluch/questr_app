import { useEffect, useState, type FormEvent } from 'react';
import type { DateCard, DateDetail, DatePeriod, DateWindow } from '../../shared/dates.ts';
import type { DiscoveryFilter, DiscoveryPreferences } from '../../shared/discovery.ts';
import { communityAncestors } from '../../shared/communities.ts';
import { api, apiBlob } from '../api.ts';
import { errorText, getLocale, languageName, locationName, t } from '../i18n.ts';
import { useCommunities } from '../community-catalog.tsx';
import { AdhocDiscoveryFilters, LanguagePicker, LocationPicker } from './Discovery.tsx';
import { Markdown } from './Markdown.tsx';
import { track } from '../analytics.ts';
import type { DateSettings as Settings } from './DatePreferences.tsx';

const periods: DatePeriod[] = ['morning', 'day', 'evening'];
const go = (id?: string, roundId?: string) => { location.hash = id ? `dates/${id}${roundId ? `/rounds/${roundId}` : ''}` : 'dates'; };
function PrivatePhoto({ url, alt, large = false }: { url: string | null; alt: string; large?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) { setSrc(null); return; }
    let active = true, objectUrl: string | null = null;
    void apiBlob(url.replace(/^\/api/, '')).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setSrc(objectUrl);
    }).catch(() => { if (active) setSrc(null); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return src ? <img className={`date-photo ${large ? 'date-photo-large' : ''}`} src={src} alt={alt} /> : <div className={`date-photo date-photo-empty ${large ? 'date-photo-large' : ''}`} aria-label={alt}>✦</div>;
}
function Windows({ windows, zone }: { windows: DateCard['windows']; zone: string }) {
  return <div className="date-windows">{windows.map(w => <span key={w.id} className="date-window-chip">{new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${w.day}T12:00:00Z`))} · {t(`dates.period.${w.period}`)}</span>)}<span className="field-hint">{zone}</span></div>;
}
function WindowEditor({ value, onChange }: { value: DateWindow[]; onChange: (value: DateWindow[]) => void }) {
  const [day, setDay] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [selected, setSelected] = useState<DatePeriod[]>(['evening']);
  function add() {
    const next = [...value];
    for (const period of selected) if (!next.some(w => w.day === day && w.period === period)) next.push({ day, period });
    onChange(next.sort((a, b) => a.day.localeCompare(b.day) || periods.indexOf(a.period) - periods.indexOf(b.period)));
  }
  return <div className="date-window-editor"><label>{t('dates.day')}<input type="date" value={day} onChange={event => setDay(event.target.value)} /></label>
    <div className="date-period-options">{periods.map(period => <label key={period} className="checkbox-label"><input type="checkbox" checked={selected.includes(period)} onChange={() => setSelected(old => old.includes(period) ? old.filter(p => p !== period) : [...old, period])} />{t(`dates.period.${period}`)}</label>)}</div>
    <button type="button" className="outline-button small" disabled={!day || !selected.length || value.length + selected.length > 42} onClick={add}>{t('dates.addWindow')}</button>
    <div className="date-windows">{value.map(w => <button type="button" className="date-window-chip" key={`${w.day}:${w.period}`} onClick={() => onChange(value.filter(item => item !== w))}>{w.day} · {t(`dates.period.${w.period}`)} ×</button>)}</div>
  </div>;
}
function AdminPhotos() {
  const [photos, setPhotos] = useState<Array<{ id: string; userId: string; displayName: string; url: string }>>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { void api<{ photos: typeof photos }>('/dates/admin/photos').then(result => setPhotos(result.photos)).catch(setError); }, []);
  async function review(photo: typeof photos[number], decision: 'approved' | 'rejected') {
    try { await api(`/dates/admin/photos/${photo.userId}/review`, { method: 'POST', body: { photoId: photo.id, decision } });
      setPhotos(old => old.filter(item => item.id !== photo.id)); }
    catch (reason) { setError(reason); }
  }
  if (!photos.length && !error) return null;
  return <section className="paper-card date-admin-review"><h2>{t('dates.reviewPhotos')}</h2>{photos.map(photo => <div key={photo.id} className="date-review-row"><PrivatePhoto url={photo.url} alt={photo.displayName} large /><div><strong>{photo.displayName}</strong><div className="date-actions"><button className="pixel-button small" onClick={() => void review(photo, 'approved')}>{t('dates.approve')}</button><button className="outline-button small" onClick={() => void review(photo, 'rejected')}>{t('dates.reject')}</button></div></div></div>)}
    {!!error && <p className="field-error" role="alert">{errorText(error)}</p>}</section>;
}
function AdminReports() {
  const [reports, setReports] = useState<Array<{ id: string; targetId: string; targetName: string; dateTitle: string; reason: 'photo' | 'harassment' | 'safety' | 'other'; photoUrl: string }>>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { void api<{ reports: typeof reports }>('/dates/admin/reports').then(result => setReports(result.reports)).catch(setError); }, []);
  async function decide(id: string, action: 'dismiss' | 'remove_photo') {
    try { await api(`/dates/admin/reports/${id}`, { method: 'POST', body: { action } }); setReports(old => old.filter(report => report.id !== id)); }
    catch (reason) { setError(reason); }
  }
  if (!reports.length && !error) return null;
  return <section className="paper-card date-admin-review"><h2>{t('dates.reports')}</h2>{reports.map(report => <div key={report.id} className="date-review-row"><PrivatePhoto url={report.photoUrl} alt={report.targetName} large /><div><strong>{report.targetName}</strong><p>{report.dateTitle} · {t(`dates.reason.${report.reason}`)}</p><div className="date-actions"><button className="pixel-button small" onClick={() => void decide(report.id, 'remove_photo')}>{t('dates.removeReportedPhoto')}</button><button className="outline-button small" onClick={() => void decide(report.id, 'dismiss')}>{t('dates.dismissReport')}</button></div></div></div>)}{!!error && <p className="field-error" role="alert">{errorText(error)}</p>}</section>;
}
function ReportDate({ dateId, targetId }: { dateId: string; targetId: string }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState<'photo' | 'harassment' | 'safety' | 'other'>('photo');
  const [done, setDone] = useState(false), [error, setError] = useState<unknown>(null);
  if (done) return <p className="field-hint">{t('dates.reportSent')}</p>;
  return <div className="date-report">{!open ? <button className="text-button" onClick={() => setOpen(true)}>{t('dates.report')}</button> : <><label>{t('dates.reportReason')}<select value={reason} onChange={event => setReason(event.target.value as typeof reason)}>{(['photo', 'harassment', 'safety', 'other'] as const).map(value => <option key={value} value={value}>{t(`dates.reason.${value}`)}</option>)}</select></label><button className="outline-button small" onClick={() => void api(`/dates/${dateId}/report`, { method: 'POST', body: { targetId, reason } }).then(() => setDone(true)).catch(setError)}>{t('dates.sendReport')}</button><button className="text-button" onClick={() => setOpen(false)}>{t('common.cancel')}</button></>}{!!error && <p role="alert" className="field-error">{errorText(error)}</p>}</div>;
}
function CreateDate({ spokenLanguages, communityIds, onCreated }: { spokenLanguages: string[]; communityIds: string[]; onCreated: (id: string) => void }) {
  const communities = useCommunities();
  const availableIds = new Set(communityIds.flatMap(id => communityAncestors(communities, id)));
  const available = communities.filter(c => availableIds.has(c.id));
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [locationIds, setLocationIds] = useState<string[]>([]);
  const [languageCodes, setLanguageCodes] = useState<string[]>(spokenLanguages.slice(0, 1));
  const [communityId, setCommunityId] = useState(''), [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [costNote, setCostNote] = useState(''), [privatePlace, setPrivatePlace] = useState(''), [windows, setWindows] = useState<DateWindow[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = await api<{ date: DateDetail }>('/dates', { method: 'POST', body: { requestId: crypto.randomUUID(), title, description,
        locationId: locationIds[0], languageCode: languageCodes[0], communityId: communityId || null, timeZone, costNote, privatePlace, windows } });
      onCreated(result.date.id);
    } catch (reason) { setError(reason); } finally { setBusy(false); }
  }
  return <form className="paper-card date-create" onSubmit={event => void submit(event)}><h2>{t('dates.create')}</h2>
    <label>{t('dates.activity')}<input value={title} onChange={event => setTitle(event.target.value)} minLength={3} maxLength={100} required /></label>
    <label>{t('dates.plan')}<textarea value={description} onChange={event => setDescription(event.target.value)} minLength={10} maxLength={2000} required /></label>
    <LocationPicker value={locationIds} onChange={setLocationIds} single collapseWhenSelected label={t('dates.location')} />
    <LanguagePicker value={languageCodes} onChange={setLanguageCodes} single collapseWhenSelected label={t('dates.language')} />
    <label>{t('dates.community')}<select value={communityId} onChange={event => setCommunityId(event.target.value)}><option value="">{t('dates.public')}</option>{available.map(c => <option value={c.id} key={c.id}>{c.name[getLocale()]}</option>)}</select></label>
    <label>{t('dates.timeZone')}<input value={timeZone} onChange={event => setTimeZone(event.target.value)} required /></label>
    <WindowEditor value={windows} onChange={setWindows} /><p className="field-hint">{t('dates.windowHint')}</p>
    <label>{t('dates.cost')}<input value={costNote} onChange={event => setCostNote(event.target.value)} maxLength={160} /></label>
    <label>{t('dates.privatePlace')}<textarea value={privatePlace} onChange={event => setPrivatePlace(event.target.value)} maxLength={1000} /></label><p className="field-hint">{t('dates.privatePlaceHint')}</p>
    <button type="submit" className="pixel-button" disabled={busy || !locationIds.length || !languageCodes.length || !windows.length}>{t('dates.publish')}</button>
    {!!error && <p className="field-error" role="alert">{errorText(error)}</p>}</form>;
}
function Detail({ id, roundId, selfId, onBack }: { id: string; roundId?: string; selfId: string; onBack: () => void }) {
  const [date, setDate] = useState<DateDetail | null>(null), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  const [opener, setOpener] = useState(''), [message, setMessage] = useState(''), [votes, setVotes] = useState<string[]>([]);
  const [localStart, setLocalStart] = useState(''), [durationMinutes, setDurationMinutes] = useState(90), [proposalWindow, setProposalWindow] = useState('');
  const [reopenWindows, setReopenWindows] = useState<DateWindow[]>([]);
  useEffect(() => { let active = true; setDate(null); setError(null);
    void api<{ date: DateDetail }>(`/dates/${id}${roundId ? `/rounds/${roundId}` : ''}`).then(result => { if (active) { setDate(result.date); setVotes(result.date.match?.votes[selfId] ?? []); track('date_viewed'); } }).catch(reason => { if (active) setError(reason); });
    return () => { active = false; };
  }, [id, roundId, selfId]);
  async function act(path: string, body: object) {
    setBusy(true); setError(null);
    try { const result = await api<{ date: DateDetail }>(`/dates/${id}${path}`, { method: 'POST', body }); setDate(result.date); setVotes(result.date.match?.votes[selfId] ?? []);
      if (path === '/responses') track('date_response_sent');
      else if (path.startsWith('/responses/') && (body as { action?: string }).action === 'accept') track('date_matched');
      else if (path === '/time/confirm') track('date_time_confirmed');
      else if (path === '/cancel') track('date_cancelled');
      if (path === '/reopen' && roundId) go(id);
      return true;
    } catch (reason) { setError(reason); return false; } finally { setBusy(false); }
  }
  if (!date) return <section><button className="text-button" onClick={onBack}>{t('common.back')}</button><p>{error ? errorText(error) : t('common.loading')}</p></section>;
  const mutual = date.match ? date.windows.filter(w => date.match!.votes[date.owner.id]?.includes(w.id) && date.match!.votes[date.match!.partnerId]?.includes(w.id)) : [];
  const canRespond = !date.isOwner && date.status === 'open' && !date.myResponse;
  return <section className="date-detail"><button className="text-button" onClick={onBack}>← {t('dates.back')}</button>
    <div className="paper-card date-detail-card"><div className="date-person"><PrivatePhoto url={date.photoUrl} alt={date.owner.displayName} /><div><span className="date-status">{t(`dates.status.${date.status}`)}</span><h1>{date.title}</h1><strong>{date.owner.displayName}</strong><p>{locationName(date.locationId, date.locationName)} · {languageName(date.languageCode)}</p></div></div>
      <p>{date.description}</p><Windows windows={date.windows} zone={date.timeZone} />{date.costNote && <p>{date.costNote}</p>}
      {date.owner.introMarkdown && <div className="date-profile"><h3>{t('dates.about')}</h3><Markdown content={date.owner.introMarkdown} /></div>}
      {!!date.owner.askMeTopics.length && <p>{t('dates.askMe')}: {date.owner.askMeTopics.join(' · ')}</p>}
      {!date.isOwner && <ReportDate dateId={date.id} targetId={date.owner.id} />}
      {date.privatePlace && <div className="date-private-place"><h3>{t('dates.meetingPlace')}</h3><p>{date.privatePlace}</p><p className="field-hint">{t('dates.placeAgree')}</p></div>}
      {canRespond && <form onSubmit={event => { event.preventDefault(); void act('/responses', { requestId: crypto.randomUUID(), message: opener }); }}><label>{t('dates.opener')}<textarea value={opener} onChange={event => setOpener(event.target.value)} minLength={20} maxLength={300} required /></label><button className="pixel-button" disabled={busy || opener.trim().length < 20}>{t('dates.sendResponse')}</button></form>}
      {date.myResponse && <p>{t(`dates.response.${date.myResponse.status}`)}</p>}
      {date.myResponse?.status === 'pending' && <button className="text-button" disabled={busy} onClick={() => void act(`/responses/${date.myResponse!.id}`, { action: 'withdraw' })}>{t('dates.withdraw')}</button>}
      {date.isOwner && date.status === 'open' && <><h2>{t('dates.responses')}</h2>{date.responses.length ? date.responses.map(response => <div className="date-response" key={response.id}><PrivatePhoto url={response.photoUrl} alt={response.displayName} /><div><h3>{response.displayName}</h3><p>{response.message}</p><Markdown content={response.introMarkdown} />{response.askMeTopics.length > 0 && <p>{t('dates.askMe')}: {response.askMeTopics.join(' · ')}</p>}<div className="date-actions"><button className="pixel-button small" disabled={busy} onClick={() => { if (window.confirm(t('dates.acceptConfirm'))) void act(`/responses/${response.id}`, { action: 'accept' }); }}>{t('dates.accept')}</button><button className="outline-button small" disabled={busy} onClick={() => void act(`/responses/${response.id}`, { action: 'decline' })}>{t('dates.decline')}</button></div><ReportDate dateId={date.id} targetId={response.userId} /></div></div>) : <p>{t('dates.noResponses')}</p>}</>}
      {date.match && <><h2>{t('dates.match')}</h2><div className="date-person"><PrivatePhoto url={date.isOwner ? date.match.partnerPhotoUrl : date.photoUrl} alt={date.isOwner ? date.match.partnerName : date.owner.displayName} /><strong>{date.isOwner ? date.match.partnerName : date.owner.displayName}</strong></div>
        {date.isOwner && <ReportDate dateId={date.id} targetId={date.match.partnerId} />}
        {['matched', 'scheduled'].includes(date.status) && <a className="outline-button small date-bot-link" href={date.match.botUrl} target="_blank" rel="noopener noreferrer">{t(date.match.botReady ? 'dates.openBotChat' : 'dates.startBot')}</a>}
        {date.status === 'matched' && <><h3>{t('dates.chooseWindows')}</h3><div className="date-period-options">{date.windows.map(w => <label className="checkbox-label" key={w.id}><input type="checkbox" checked={votes.includes(w.id)} onChange={() => setVotes(old => old.includes(w.id) ? old.filter(id => id !== w.id) : [...old, w.id])} />{w.day} · {t(`dates.period.${w.period}`)}</label>)}</div><button className="outline-button small" disabled={busy} onClick={() => void api<{ date: DateDetail }>(`/dates/${id}/votes`, { method: 'PUT', body: { windowIds: votes } }).then(result => setDate(result.date)).catch(setError)}>{t('dates.saveWindows')}</button>
          {mutual.length > 0 && <div className="date-time-proposal"><h3>{t('dates.mutualWindows')}</h3><select value={proposalWindow} onChange={event => setProposalWindow(event.target.value)}><option value="">{t('dates.chooseWindow')}</option>{mutual.map(w => <option value={w.id} key={w.id}>{w.day} · {t(`dates.period.${w.period}`)}</option>)}</select><label>{t('dates.exactTime')}<input type="datetime-local" value={localStart} onChange={event => setLocalStart(event.target.value)} /></label><label>{t('dates.duration')}<input type="number" value={durationMinutes} min={30} max={480} onChange={event => setDurationMinutes(Number(event.target.value))} /></label><button className="outline-button small" disabled={busy || !proposalWindow || !localStart} onClick={() => void act('/time', { windowId: proposalWindow, localStart, durationMinutes })}>{t('dates.proposeTime')}</button></div>}
          {date.match.proposedStart && <div className="date-time-proposal"><p>{t('dates.proposed')}: {new Intl.DateTimeFormat(getLocale(), { timeZone: date.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date.match.proposedStart))} · {date.match.durationMinutes} {t('dates.minutes')}</p>{date.match.proposedBy !== selfId && <button className="pixel-button small" disabled={busy} onClick={() => void act('/time/confirm', {})}>{t('dates.confirmTime')}</button>}</div>}</>}
        {date.status === 'scheduled' && date.match.proposedStart && <p>{t('dates.confirmed')}: {new Intl.DateTimeFormat(getLocale(), { timeZone: date.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date.match.proposedStart))}</p>}
        {['matched', 'scheduled'].includes(date.status) && <div className="date-chat"><h3>{t('dates.chat')}</h3><p className="field-hint">{t('dates.chatHint')}</p>{date.messages.map(m => <p key={m.id}><strong>{m.senderId === selfId ? t('dates.you') : date.isOwner ? date.match!.partnerName : date.owner.displayName}:</strong> {m.attachmentType && <span>{t(m.attachmentType === 'photo' ? 'dates.chatPhoto' : 'dates.chatFile')}{m.body ? ' · ' : ''}</span>}{m.body}</p>)}<form onSubmit={event => { event.preventDefault(); void act('/messages', { requestId: crypto.randomUUID(), body: message }).then(sent => { if (sent) setMessage(''); }); }}><textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={2000} required /><button className="pixel-button small" disabled={busy || !message.trim()}>{t('dates.sendMessage')}</button></form></div>}</>}
      {['open', 'matched', 'scheduled'].includes(date.status) && (date.isOwner || date.match) && <button className="text-button" disabled={busy} onClick={() => { if (window.confirm(t('dates.cancelConfirm'))) void act('/cancel', { reason: 'plans_changed' }); }}>{t('dates.cancel')}</button>}
      {date.status === 'scheduled' && date.match?.proposedStart && Date.parse(date.match.proposedStart) + (date.match.durationMinutes ?? 0) * 60000 < Date.now() && <button className="outline-button small" disabled={busy} onClick={() => void act('/complete', {})}>{t('dates.complete')}</button>}
      {date.isOwner && ['cancelled', 'expired'].includes(date.status) && <div><h3>{t('dates.reopen')}</h3><WindowEditor value={reopenWindows} onChange={setReopenWindows} /><button className="pixel-button small" disabled={busy || !reopenWindows.length} onClick={() => void act('/reopen', { requestId: crypto.randomUUID(), windows: reopenWindows })}>{t('dates.reopen')}</button></div>}
      {!!error && <p className="field-error" role="alert">{errorText(error)}</p>}
    </div></section>;
}
export function Dates({ selfId, admin, discovery, spokenLanguages, communityIds, detailId }: { selfId: string; admin: boolean; discovery: DiscoveryPreferences; spokenLanguages: string[]; communityIds: string[]; detailId: string | null }) {
  const [settings, setSettings] = useState<Settings | null>(null), [view, setView] = useState<'discover' | 'mine'>('discover');
  const [filters, setFilters] = useState<DiscoveryFilter | null>(null), [cards, setCards] = useState<DateCard[]>([]), [nextOffset, setNextOffset] = useState<number | null>(null);
  const [creating, setCreating] = useState(false), [error, setError] = useState<unknown>(null);
  useEffect(() => { void api<{ settings: Settings }>('/dates/me/settings').then(result => setSettings(result.settings)).catch(setError); }, []);
  useEffect(() => {
    if (detailId || !settings || view === 'discover' && (!settings.enabled || settings.paused || settings.photoStatus !== 'approved' || !settings.romanceReady)) return;
    let active = true;
    const query = new URLSearchParams({ view }); if (filters && view === 'discover') query.set('filters', JSON.stringify(filters));
    void api<{ dates: DateCard[]; nextOffset: number | null }>(`/dates?${query}`).then(result => { if (active) { setCards(result.dates); setNextOffset(result.nextOffset); } }).catch(reason => { if (active) setError(reason); });
    return () => { active = false; };
  }, [detailId, settings, view, filters]);
  if (detailId) { const [id, , roundId] = detailId.split('/'); return <Detail id={id} roundId={roundId} selfId={selfId} onBack={() => go()} />; }
  const ready = settings?.enabled && !settings.paused && settings.photoStatus === 'approved' && settings.romanceReady;
  return <section className="dates-page"><div className="page-heading"><h1>{t('dates.title')}</h1></div>
    {admin && <AdminPhotos />}
    {admin && <AdminReports />}
    <div className="date-list-controls"><button className={view === 'discover' ? 'pixel-button small' : 'outline-button small'} onClick={() => { setView('discover'); setCreating(false); }}>{t('dates.discover')}</button><button className={view === 'mine' ? 'pixel-button small' : 'outline-button small'} onClick={() => { setView('mine'); setCreating(false); }}>{t('dates.mine')}</button></div>
    {view === 'discover' && <><p className="field-hint">{t('dates.sharedFilters')}</p><AdhocDiscoveryFilters defaults={discovery} value={filters} onChange={setFilters} /></>}
    {ready && <div className="date-actions"><button className="pixel-button small" onClick={() => setCreating(!creating)}>{t(creating ? 'common.cancel' : 'dates.create')}</button></div>}
    {creating && ready && <CreateDate spokenLanguages={spokenLanguages} communityIds={communityIds} onCreated={id => go(id)} />}
    {view === 'discover' && !ready ? <div className="paper-card date-empty"><p>{settings ? t('dates.setupHint') : t('common.loading')}</p><a className="outline-button small" href="#character/dates">{t('dates.openSettings')}</a></div> : <div className="date-card-list">{cards.map(card => <button className="paper-card date-card" key={card.roundId} onClick={() => go(card.id, view === 'mine' ? card.roundId : undefined)}><PrivatePhoto url={card.photoUrl} alt={card.owner.displayName} /><span><span className="date-status">{t(`dates.status.${card.status}`)}</span><strong>{card.title}</strong><span>{card.owner.displayName} · {locationName(card.locationId, card.locationName)} · {languageName(card.languageCode)}</span><Windows windows={card.windows} zone={card.timeZone} /></span></button>)}{!cards.length && <p className="date-empty">{t('dates.empty')}</p>}
      {nextOffset !== null && <button className="outline-button small" onClick={() => { const query = new URLSearchParams({ view, offset: String(nextOffset) }); if (filters && view === 'discover') query.set('filters', JSON.stringify(filters)); void api<{ dates: DateCard[]; nextOffset: number | null }>(`/dates?${query}`).then(result => { setCards(old => [...old, ...result.dates]); setNextOffset(result.nextOffset); }).catch(setError); }}>{t('dates.more')}</button>}</div>}
    {!!error && <p className="field-error" role="alert">{errorText(error)}</p>}
  </section>;
}
