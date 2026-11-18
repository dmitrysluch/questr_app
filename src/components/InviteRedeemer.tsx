import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { errorText, t } from '../i18n.ts';

export function InviteRedeemer({ onRedeemed, initialCode = '' }: { onRedeemed: () => Promise<unknown>; initialCode?: string }) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  async function redeem(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSaved(false);
    try {
      await api('/invites/redeem', { method: 'POST', body: { code: code.trim() } });
      await onRedeemed(); setCode(''); setSaved(true);
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  return <form className="invite-redeemer paper-card" onSubmit={event => void redeem(event)}><h2>{t('invites.addCode')}</h2>
    <div><input aria-label={t('invites.code')} value={code} onChange={event => { setCode(event.target.value); setSaved(false); }} placeholder="QUEST-…" required maxLength={120} disabled={busy} /><button className="outline-button small" disabled={busy || !code.trim()}>{t('invites.redeem')}</button></div>
    {saved && <p role="status">{t('invites.redeemed')}</p>}{error !== null && <p className="field-error" role="alert">{errorText(error)}</p>}
  </form>;
}
