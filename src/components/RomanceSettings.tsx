import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { errorText, t } from '../i18n.ts';
import { romanceCategories, type RomanceCategory, type RomanceSettings as Settings } from '../../shared/romance.ts';
import { PixelEmoji } from './PixelEmoji.tsx';
import { DatePreferences } from './DatePreferences.tsx';

export function RomanceSettings() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [gender, setGender] = useState<RomanceCategory | ''>('');
  const [interestedIn, setInterestedIn] = useState<RomanceCategory[]>([]);
  const [consent, setConsent] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  function load(settings: Settings) {
    setSaved(settings);
    setGender(settings.gender ?? '');
    setInterestedIn(settings.interestedIn);
    setConsent(false);
    setEditing(false);
  }
  useEffect(() => {
    let active = true;
    void api<{ romance: Settings }>('/me/romance').then(result => { if (active) load(result.romance); }).catch(reason => { if (active) setError(reason); });
    return () => { active = false; };
  }, []);
  function toggle(category: RomanceCategory) {
    setInterestedIn(current => current.includes(category) ? current.filter(item => item !== category) : [...current, category]);
  }
  async function save() {
    if (!saved || !gender || !interestedIn.length || !consent) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ romance: Settings }>('/me/romance', { method: 'PUT', body: { revision: saved.revision, gender, interestedIn, consent: true } });
      load(result.romance);
    } catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setError(null);
    try {
      const result = await api<{ romance: Settings }>('/me/romance', { method: 'DELETE', body: {} });
      load(result.romance);
    } catch (reason) { setError(reason); }
    finally { setBusy(false); }
  }
  return <section className="romance-settings paper-card" aria-labelledby="romance-title">
    <h2 id="romance-title"><PixelEmoji emoji="💗" />{t('romance.title')}</h2>
    {!saved ? <p>{error ? errorText(error) : t('common.loading')}</p> : <>
      <p className="romance-status">{saved.enabled ? t('romance.enabled') : t('romance.disabled')}</p>
      {!editing ? <div className="romance-actions"><button type="button" className="outline-button" onClick={() => setEditing(true)}>{t(saved.enabled ? 'romance.change' : 'romance.enable')}</button>{saved.enabled && <button type="button" className="text-button" disabled={busy} onClick={() => void disable()}>{t('romance.disable')}</button>}</div> : <>
        <fieldset><legend>{t('romance.gender')}</legend><div className="romance-options">{romanceCategories.map(category => <label key={category} className="romance-choice"><input type="radio" name="romance-gender" checked={gender === category} onChange={() => setGender(category)} />{t(`romance.self.${category}`)}</label>)}</div></fieldset>
        <fieldset><legend>{t('romance.interestedIn')}</legend><div className="romance-options"><label className="romance-choice"><input type="checkbox" checked={interestedIn.length === romanceCategories.length} onChange={event => setInterestedIn(event.target.checked ? [...romanceCategories] : [])} />{t('romance.everyone')}</label>{romanceCategories.map(category => <label key={category} className="romance-choice"><input type="checkbox" checked={interestedIn.includes(category)} onChange={() => toggle(category)} />{t(`romance.category.${category}`)}</label>)}</div></fieldset>
        <p className="romance-privacy">{t('romance.privacy')}</p>
        <label className="checkbox-label romance-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />{t('romance.consent')}</label>
        <div className="romance-actions"><button type="button" className="pixel-button small" disabled={busy || !gender || !interestedIn.length || !consent} onClick={() => void save()}>{t('romance.save')}</button><button type="button" className="text-button" disabled={busy} onClick={() => { load(saved); setError(null); }}>{t('common.cancel')}</button></div>
      </>}
      {saved.enabled && <DatePreferences key={saved.revision} />}
    </>}
    {!!error && !!saved && <p role="alert" className="romance-error">{errorText(error)}</p>}
  </section>;
}
