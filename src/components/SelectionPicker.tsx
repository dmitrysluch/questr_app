import { useEffect, useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { t } from '../i18n.ts';

export interface Choice { id: string; label: string; detail?: string; source?: 'google' }
export function SelectionPicker({ label, placeholder, value, items, selected, query, onQuery, onChange, loading = false, pending = false, limit = 50, replaceOnSelect = false }: {
  label: string; placeholder: string; value: string[]; items: Choice[]; selected: Choice[];
  query: string; onQuery: (query: string) => void; onChange: (value: string[]) => void; loading?: boolean; pending?: boolean; limit?: number; replaceOnSelect?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const available = items.filter(item => !value.includes(item.id));
  const index = Math.min(active, Math.max(0, available.length - 1));
  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [index, open, id]);
  function choose(item: Choice) {
    if (loading || (!replaceOnSelect && value.length >= limit)) return;
    onChange(replaceOnSelect ? [item.id] : [...value, item.id]); onQuery(''); setActive(0); setOpen(false); input.current?.focus();
  }
  return <div className="selection-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <label htmlFor={id}>{label}</label>
    {!!value.length && <div className="selection-chips" aria-label={label}>{value.map(code => {
      const item = selected.find(item => item.id === code);
      return <button type="button" className="selection-chip" key={code} onClick={() => onChange(value.filter(id => id !== code))} aria-label={t('selection.remove', { name: item?.label ?? code })}>{item?.label ?? code}{item?.source === 'google' && <small className="google-attribution" translate="no"> · Google Maps</small>}<X size={12} aria-hidden="true" /></button>;
    })}</div>}
    <div className="selection-input"><Search size={16} aria-hidden="true" /><input id={id} ref={input} role="combobox" autoComplete="off" value={query} placeholder={placeholder}
      aria-expanded={open} aria-controls={`${id}-results`} aria-autocomplete="list" aria-activedescendant={open && available[index] ? `${id}-option-${index}` : undefined}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={event => { onQuery(event.target.value); setOpen(true); setActive(0); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { setOpen(false); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          setActive(old => Math.max(0, Math.min(available.length - 1, old + (event.key === 'ArrowDown' ? 1 : -1))));
        }
        if (event.key === 'Enter' && open) { event.preventDefault(); if (available[index]) choose(available[index]); }
      }} />
      {query && <button type="button" className="selection-clear" aria-label={t('tags.clear')} onClick={() => { onQuery(''); input.current?.focus(); }}><X size={15} /></button>}
    </div>
    {open && <div className="selection-results" id={`${id}-results`} role="listbox" aria-label={label} aria-busy={loading || pending}>
      {loading ? <p role="status">{t('common.loading')}</p> : !replaceOnSelect && value.length >= limit ? <p>{t('selection.limit', { count: limit })}</p> : !available.length ? <p role={pending ? 'status' : undefined}>{t(pending ? 'common.loading' : 'selection.empty')}</p> : available.map((item, position) => <div
        key={item.id} id={`${id}-option-${position}`} role="option" aria-selected={index === position} className={[index === position ? 'active' : '', item.source === 'google' ? 'google-result' : ''].filter(Boolean).join(' ')}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(position)} onClick={() => choose(item)}>
        <span>{item.label}</span>{item.detail && <small dir="auto">{item.detail}</small>}{item.source === 'google' && <small className="google-attribution" translate="no">Google Maps</small>}
      </div>)}
      {pending && !loading && !!available.length && <p role="status">{t('common.loading')}</p>}
    </div>}
  </div>;
}
