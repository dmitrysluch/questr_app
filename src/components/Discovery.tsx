import { useEffect, useRef, useState } from 'react';
import { Globe2, Languages, Check } from 'lucide-react';
import { languages, normalizeSearch, type DiscoveryPreferences, type Location } from '../../shared/discovery.ts';
import { api, ApiError } from '../api.ts';
import { errorText, getLocale, languageName, locationName, t } from '../i18n.ts';
import { SelectionPicker, type Choice } from './SelectionPicker.tsx';

export function LanguagePicker({ value, onChange, label }: { value: string[]; onChange: (codes: string[]) => void; label: string }) {
  const [query, setQuery] = useState('');
  const languageChoices = languages.map(language => ({ id: language.code, label: languageName(language.code), detail: language.native, english: language.label }))
    .sort((a, b) => a.label.localeCompare(b.label, getLocale()));
  const search = normalizeSearch(query);
  const items = languageChoices.filter(item => normalizeSearch(`${item.label}${item.detail}${item.english}${item.id}`).includes(search));
  return <SelectionPicker label={label} placeholder={t('languages.search')} value={value} onChange={onChange} selected={languageChoices} items={items} query={query} onQuery={setQuery} />;
}
export function SpokenLanguages({ codes }: { codes: string[] }) {
  if (!codes.length) return null;
  return <p className="spoken-languages"><Languages size={15} aria-hidden="true" /><span><span className="sr-only">{t('languages.spoken')}: </span>{codes.map(languageName).join(' · ')}</span></p>;
}
function locationChoice(location: Location): Choice {
  return { id: location.id, label: location.kind === 'country' ? t('locations.allCountry', { name: locationName(location.id, location.name) }) : locationName(location.id, location.name),
    detail: location.kind === 'city' ? locationName(location.parentId ?? '', location.countryName ?? '') : location.kind === 'online' ? t('locations.global') : t('locations.country') };
}
export function LocationPicker({ value, onChange, single = false }: { value: string[]; onChange: (ids: string[]) => void; single?: boolean }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Location[]>([]);
  const [cache, setCache] = useState<Record<string, Location>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const cacheRef = useRef(cache); cacheRef.current = cache;
  const idsKey = value.join(',');
  useEffect(() => {
    const missing = value.filter(id => !cacheRef.current[id]);
    if (!missing.length) return;
    let active = true;
    api<{ locations: Location[] }>(`/locations?ids=${encodeURIComponent(missing.join(','))}`).then(result => {
      if (active) setCache(old => ({ ...old, ...Object.fromEntries(result.locations.map(item => [item.id, item])) }));
    }).catch(error => { if (active) setError(error); });
    return () => { active = false; };
  }, [idsKey, retry]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setItems([]);
    const timer = setTimeout(() => {
      api<{ locations: Location[] }>(`/locations?q=${encodeURIComponent(query)}`).then(result => {
        if (!active) return;
        setItems(result.locations);
        setCache(old => ({ ...old, ...Object.fromEntries(result.locations.map(item => [item.id, item])) }));
      }).catch(error => { if (active) setError(error); }).finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [query, retry]);
  return <><SelectionPicker label={t('locations.label')} placeholder={t('locations.search')} value={value} onChange={onChange}
    query={query} onQuery={setQuery} loading={loading} limit={single ? 1 : 50} items={items.filter(item => !single || item.kind !== 'country').map(locationChoice)} selected={Object.values(cache).map(locationChoice)} />
    {!!error && <p className="field-error" role="alert">{errorText(error)} <button type="button" className="text-button" onClick={() => setRetry(old => old + 1)}>{t('common.retry')}</button></p>}</>;
}
export function DiscoverySettings({ initial, spokenLanguages, onSaved, required = false, inline = false, onDirtyChange }: { initial: DiscoveryPreferences; spokenLanguages: string[]; onSaved: (preferences: DiscoveryPreferences) => void; required?: boolean; inline?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const complete = value.locationIds.length > 0 && value.languageCodes.length > 0;
  const edit = (change: Partial<DiscoveryPreferences>) => { setValue(old => ({ ...old, ...change })); setSaved(false); };
  async function save() {
    if (required && !complete) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ discovery: DiscoveryPreferences }>('/discovery', { method: 'PUT', body: value });
      setValue(result.discovery); onSaved(result.discovery); setSaved(true);
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true);
    try {
      const result = await api<{ discovery: DiscoveryPreferences }>('/me');
      setValue(result.discovery); onSaved(result.discovery); setError(null); setSaved(false);
    } catch (error) { setError(error); } finally { setBusy(false); }
  }
  const body = <div className="discovery-body"><p className="field-hint">{t(required ? 'discovery.onboardingHint' : 'discovery.private')}</p>
      <fieldset disabled={busy}>
        <LocationPicker value={value.locationIds} onChange={locationIds => edit({ locationIds })} />
        <p className="field-hint">{t('locations.hint')}</p>
        <LanguagePicker label={t('discovery.languages')} value={value.languageCodes} onChange={languageCodes => edit({ languageCodes })} />
        {!!spokenLanguages.length && <button type="button" className="text-button use-spoken" onClick={() => edit({ languageCodes: spokenLanguages })}>{t('discovery.useSpoken')}</button>}
      </fieldset>
      {required && !complete && <p className="field-hint">{t('discovery.requiredHint')}</p>}
      {!required && !value.locationIds.length && <p className="field-hint">{t('discovery.empty')}</p>}
      {!required && value.locationIds.length > 0 && !value.languageCodes.length && <p className="field-hint">{t('discovery.allLanguages')}</p>}
      {!!error && <p className="field-error" role="alert">{errorText(error)}{error instanceof ApiError && error.code === 'PREFERENCES_CONFLICT' && <button type="button" className="text-button" disabled={busy} onClick={() => void reload()}>{t('discovery.reload')}</button>}</p>}
      <div className="discovery-actions"><span role="status">{(saved || required && !dirty && complete) && <><Check size={14} />{t('common.saved')}</>}</span><button type="button" className="pixel-button small" disabled={busy || !dirty || required && !complete} onClick={() => void save()}>{t(busy ? 'common.saving' : 'discovery.save')}</button></div>
      <small className="location-credit">{t('locations.coverage')} <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></small>
    </div>;
  return required || inline ? <section className="discovery-settings discovery-onboarding" id={required ? 'onboarding-discovery' : undefined}><h2><Globe2 size={18} aria-hidden="true" />{t('discovery.title')}{dirty && <span className="unsaved-dot" aria-label={t('common.unsaved')} />}</h2>{body}</section>
    : <details className="discovery-settings"><summary><Globe2 size={17} aria-hidden="true" />{t('discovery.title')}{dirty && <span className="unsaved-dot" aria-label={t('common.unsaved')} />}</summary>{body}</details>;
}
