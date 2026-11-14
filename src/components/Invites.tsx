import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ClipboardCopy, LoaderCircle, Plus, RotateCw, X } from 'lucide-react';
import type { InviteBudget, InviteRecord, InviterAccount } from '../../shared/schema.ts';
import { api } from '../api.ts';
import { errorText, getLocale, t } from '../i18n.ts';

type Listing = { invites: InviteRecord[]; total: number; budget: InviteBudget | null; admin: boolean };
const empty: Listing = { invites: [], total: 0, budget: null, admin: false };
const date = (value: string) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return `QUEST-${btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_')}`;
}

export function Invites({ admin }: { admin: boolean }) {
  const [listing, setListing] = useState<Listing>(empty);
  const [users, setUsers] = useState<InviterAccount[]>([]);
  const [search, setSearch] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [issuedCode, setIssuedCode] = useState<{ id: string; code: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = useRef<{ requestId: string; code: string; expiresInDays: number } | null>(null);
  async function refresh(q = search) {
    const [next, accounts] = await Promise.all([
      api<Listing>('/invites'),
      admin ? api<{ users: InviterAccount[] }>(`/invites/admin/inviters?q=${encodeURIComponent(q)}`) : Promise.resolve(null),
    ]);
    setListing(next); if (accounts) setUsers(accounts.users);
  }
  async function loadMore() {
    setBusy(true); setError(null);
    try {
      const next = await api<Listing>(`/invites?offset=${listing.invites.length}`);
      setListing(current => ({ ...current, invites: [...current.invites, ...next.invites], total: next.total, budget: next.budget }));
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    void Promise.all([api<Listing>('/invites'), admin ? api<{ users: InviterAccount[] }>('/invites/admin/inviters') : Promise.resolve(null)])
      .then(([next, accounts]) => { if (active) { setListing(next); if (accounts) setUsers(accounts.users); } })
      .catch(problem => { if (active) setError(problem); });
    return () => { active = false; };
  }, [admin]);
  async function issue() {
    if (busy) return;
    const request = pending.current ?? { requestId: crypto.randomUUID(), code: newCode(), expiresInDays };
    pending.current = request; setBusy(true); setError(null);
    try {
      const result = await api<{ id: string }>('/invites', { method: 'POST', body: request });
      setIssuedCode({ id: result.id, code: request.code }); pending.current = null;
      await refresh();
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  async function revoke(inviteId: string) {
    setBusy(true); setError(null);
    try {
      await api(`/invites/${inviteId}/revoke`, { method: 'POST', body: {} });
      setIssuedCode(current => current?.id === inviteId ? null : current);
      setConfirmId(null); await refresh();
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  async function searchUsers(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await refresh(search); } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  const budget = listing.budget;
  return <section className="invites-page">
    <div className="page-heading"><span className="eyebrow">QUESTR / {t(admin ? 'nav.admin' : 'nav.invites')}</span><h1>{t('invites.title')}</h1></div>
    {error !== null && <div className="error-banner" role="alert">{errorText(error)}<button className="text-button" onClick={() => { setError(null); void refresh().catch(setError); }}>{t('common.retry')}</button></div>}
    <div className="invite-grid">
      <div className="paper-card invite-issue">
        <h2>{t('invites.issue')}</h2>
        <p className="hint">{budget ? t('invites.budget', { used: budget.used, max: budget.maxUses, days: budget.windowDays }) : t('invites.noBudget')}</p>
        <label htmlFor="invite-expiry">{t('invites.expires')}</label>
        <select id="invite-expiry" value={expiresInDays} disabled={busy} onChange={event => { setExpiresInDays(Number(event.target.value)); pending.current = null; }}>
          {[1, 7, 30].map(days => <option key={days} value={days}>{t('invites.days', { count: days })}</option>)}
        </select>
        <button className="pixel-button" disabled={busy || !budget || budget.used >= budget.maxUses} onClick={() => void issue()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{t('invites.create')}</button>
        {issuedCode && <div className="issued-invite" role="status"><span>{t('invites.copyNow')}</span><code>{issuedCode.code}</code><button className="outline-button small" onClick={() => void navigator.clipboard.writeText(issuedCode.code).catch(setError)}><ClipboardCopy size={15} />{t('invites.copy')}</button></div>}
      </div>
      <div className="paper-card invite-list-card"><div className="invite-list-header"><div><h2>{t('invites.list')}</h2><span>{listing.total}</span></div><button className="text-button" disabled={busy} onClick={() => void refresh().catch(setError)}><RotateCw size={15} />{t('events.refresh')}</button></div>
        {!listing.invites.length ? <p className="hint">{t('invites.empty')}</p> : <ul className="invite-list">{listing.invites.map(invite => <li key={invite.id}>
          <div><span className={`invite-status ${invite.status}`}>{t(`invites.status.${invite.status}`)}</span><span className="invite-date">{t('invites.expiryDate', { date: date(invite.expiresAt) })}</span></div>
          {admin && invite.createdBy && <span className="invite-person">{t('invites.issuer', { name: invite.createdBy })}</span>}
          {invite.redeemedBy && <span className="invite-person">{t('invites.usedBy', { name: invite.redeemedBy })}</span>}
          {invite.status === 'active' && (confirmId === invite.id ? <div className="invite-actions"><button className="outline-button small" disabled={busy} onClick={() => void revoke(invite.id)}><Check size={14} />{t('invites.confirmRevoke')}</button><button className="text-button" onClick={() => setConfirmId(null)}><X size={14} />{t('common.cancel')}</button></div> : <button className="text-button invite-revoke" disabled={busy} onClick={() => setConfirmId(invite.id)}>{t('invites.revoke')}</button>)}
        </li>)}</ul>}
        {listing.invites.length < listing.total && <button className="text-button" disabled={busy} onClick={() => void loadMore()}>{t('events.more')}</button>}
      </div>
    </div>
    {admin && <section className="admin-inviters"><div className="section-heading"><h2>{t('invites.inviterAccess')}</h2></div>
      <form className="admin-search" onSubmit={event => void searchUsers(event)}><input aria-label={t('invites.searchUsers')} placeholder={t('invites.searchUsers')} value={search} onChange={event => setSearch(event.target.value)} maxLength={80} /><button className="outline-button small" disabled={busy} type="submit">{t('invites.search')}</button></form>
      <div className="admin-user-list">{users.map(user => <InviterSettings key={`${user.id}:${user.isInviter}:${user.budget?.maxUses}:${user.budget?.windowDays}:${user.budget?.used}`} user={user} onSaved={() => refresh()} />)}</div>
    </section>}
  </section>;
}

function InviterSettings({ user, onSaved }: { user: InviterAccount; onSaved: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(user.isAdmin || user.isInviter);
  const [maxUses, setMaxUses] = useState(user.budget?.maxUses ?? 3);
  const [windowDays, setWindowDays] = useState(user.budget?.windowDays ?? 7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await api(`/invites/admin/inviters/${user.id}`, { method: 'PUT', body: { enabled, maxUses, windowDays } });
      await onSaved();
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  return <form className="paper-card admin-user" onSubmit={event => void save(event)}>
    <div className="admin-user-head"><strong dir="auto">{user.displayName}</strong>{user.isAdmin && <span className="invite-status active">{t('nav.admin')}</span>}</div>
    <label className="checkbox-label"><input type="checkbox" checked={enabled} disabled={user.isAdmin || busy} onChange={event => setEnabled(event.target.checked)} />{t('invites.canInvite')}</label>
    <div className="admin-budget-fields"><label>{t('invites.maxUses')}<input type="number" min={0} max={100} value={maxUses} disabled={busy} onChange={event => setMaxUses(Number(event.target.value))} required /></label>
      <label>{t('invites.windowDays')}<input type="number" min={1} max={90} value={windowDays} disabled={busy} onChange={event => setWindowDays(Number(event.target.value))} required /></label></div>
    <div className="admin-user-footer"><span>{t('invites.used', { count: user.budget?.used ?? 0 })}</span><button className="outline-button small" type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{t('invites.saveAccess')}</button></div>
    {error !== null && <p className="field-error" role="alert">{errorText(error)}</p>}
  </form>;
}
