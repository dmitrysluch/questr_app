import { useEffect, useState, type FormEvent } from 'react';
import { communities } from '../../shared/communities.ts';
import { api } from '../api.ts';
import { errorText, getLocale, t } from '../i18n.ts';

type DomainRule = { domain: string; enabled: boolean; allowRegistration: boolean; communityIds: string[] };
const blank = (): DomainRule => ({ domain: '', enabled: true, allowRegistration: true, communityIds: [] });

export function EmailDomainsAdmin() {
  const [rules, setRules] = useState<DomainRule[]>([]);
  const [draft, setDraft] = useState<DomainRule>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  async function refresh() { setRules((await api<{ domains: DomainRule[] }>('/email-invites/admin/domains')).domains); }
  useEffect(() => { void refresh().catch(setError); }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSaved(false);
    try {
      await api('/email-invites/admin/domains', { method: 'PUT', body: draft });
      await refresh(); setDraft(blank()); setSaved(true);
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  return <section className="email-domains-admin paper-card">
    <h2>{t('emailInvite.adminTitle')}</h2>
    <form onSubmit={event => void save(event)}>
      <label htmlFor="email-domain-rule">{t('emailInvite.domain')}</label>
      <input id="email-domain-rule" value={draft.domain} onChange={event => setDraft(old => ({ ...old, domain: event.target.value }))} placeholder="university.edu" autoCapitalize="none" spellCheck={false} required disabled={busy} />
      <label className="checkbox-label"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => setDraft(old => ({ ...old, enabled: event.target.checked }))} />{t('emailInvite.enabled')}</label>
      <label className="checkbox-label"><input type="checkbox" checked={draft.allowRegistration} disabled={busy} onChange={event => setDraft(old => ({ ...old, allowRegistration: event.target.checked }))} />{t('emailInvite.allowRegistration')}</label>
      <fieldset className="invite-community-grants"><legend>{t('communities.label')}</legend>{communities.map(community => <label key={community.id} className="checkbox-label"><input type="checkbox" checked={draft.communityIds.includes(community.id)} disabled={busy} onChange={event => setDraft(old => ({ ...old, communityIds: event.target.checked ? [...old.communityIds, community.id] : old.communityIds.filter(id => id !== community.id) }))} />{community.name[getLocale()]}</label>)}</fieldset>
      <div className="email-domain-actions"><button className="outline-button small" type="submit" disabled={busy || !draft.domain.trim()}>{t('emailInvite.saveRule')}</button><button className="text-button" type="button" onClick={() => setDraft(blank())}>{t('emailInvite.newRule')}</button></div>
    </form>
    {saved && <p role="status">{t('emailInvite.ruleSaved')}</p>}
    {error !== null && <p className="field-error" role="alert">{errorText(error)}</p>}
    {rules.length > 0 && <ul className="email-domain-list">{rules.map(rule => <li key={rule.domain}><button type="button" className="text-button" onClick={() => { setDraft({ ...rule }); setSaved(false); }}>{rule.domain}</button><span>{rule.enabled ? t('emailInvite.enabled') : t('emailInvite.disabled')}{rule.allowRegistration ? ` · ${t('emailInvite.allowRegistration')}` : ''}{rule.communityIds.length ? ` · ${rule.communityIds.map(id => communities.find(item => item.id === id)?.name[getLocale()] ?? id).join(', ')}` : ''}</span></li>)}</ul>}
  </section>;
}
