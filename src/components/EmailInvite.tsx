import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { errorText, t } from '../i18n.ts';

type Status = { available: boolean; verifiedEmails: { email: string; domain: string; registrationAllowed: boolean }[] };

export function EmailInvite({ onVerified, registration = false }: { onVerified: () => Promise<unknown>; registration?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState(false);
  useEffect(() => { let active = true; void api<Status>('/email-invites/status').then(value => { if (active) setStatus(value); }).catch(problem => { if (active) setError(problem); }); return () => { active = false; }; }, []);
  if (!status) return error !== null ? <p className="field-error" role="alert">{errorText(error)}</p> : null;
  if (!status.available) return null;
  async function requestCode(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSuccess(false);
    try { await api('/email-invites/request', { method: 'POST', body: { email } }); setRequested(true); }
    catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await api('/email-invites/verify', { method: 'POST', body: { email, code } });
      setStatus(await api<Status>('/email-invites/status'));
      setRequested(false); setCode(''); setSuccess(true); await onVerified();
    } catch (problem) { setError(problem); } finally { setBusy(false); }
  }
  return <div className="email-invite paper-card">
    <h2>{t('emailInvite.title')}</h2>
    <p className="hint">{t(registration ? 'emailInvite.hintRegistration' : 'emailInvite.hint')}</p>
    {status.verifiedEmails.length > 0 && <ul className="email-invite-verified">{status.verifiedEmails.map(item => <li key={item.email}>{item.email} ✓</li>)}</ul>}
    {!requested ? <form onSubmit={event => void requestCode(event)}>
      <label htmlFor="email-invite-address">{t('emailInvite.address')}</label>
      <div className="email-invite-row"><input id="email-invite-address" type="email" value={email} onChange={event => setEmail(event.target.value)} autoCapitalize="none" autoComplete="email" required disabled={busy} /><button className="outline-button small" type="submit" disabled={busy}>{t('emailInvite.send')}</button></div>
    </form> : <form onSubmit={event => void verify(event)}>
      <label htmlFor="email-invite-code">{t('emailInvite.code')}</label>
      <div className="email-invite-row"><input id="email-invite-code" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} value={code} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" required disabled={busy} /><button className="outline-button small" type="submit" disabled={busy}>{t('emailInvite.verify')}</button></div>
      <button type="button" className="text-button" disabled={busy} onClick={() => { setRequested(false); setCode(''); }}>{t('emailInvite.change')}</button>
    </form>}
    {requested && <p className="hint">{t('emailInvite.sent')}</p>}
    {success && <p role="status">{t('emailInvite.success')}</p>}
    {error !== null && <p className="field-error" role="alert">{errorText(error)}</p>}
  </div>;
}
