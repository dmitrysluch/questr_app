import { useEffect, useId, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { tags, tagCategories, type TagCategory } from '../../shared/catalog.ts';
import { searchTags } from '../../shared/tag-search.ts';
import { maxProfileTags, tagKey, tagSchema, type ProfileTag } from '../../shared/schema.ts';
import { getLocale, t, tagName } from '../i18n.ts';
import { Modal } from './Modal.tsx';
import { PixelEmoji } from './PixelEmoji.tsx';

export function tagDisplay(tag: ProfileTag) {
  if (tag.kind === 'custom') return { label: tag.label, emoji: tag.emoji };
  const item = tags.find(item => item.code === tag.code);
  return item ? { ...item, label: tagName(item.code, item.label) } : { label: tag.code, emoji: '✨' };
}
export function TagPills({ items }: { items: ProfileTag[] }) {
  return <div className="tag-list">{items.map(tag => {
    const item = tagDisplay(tag);
    return <span className="tag-pill" key={tagKey(tag)}><PixelEmoji emoji={item.emoji} />{item.label}</span>;
  })}</div>;
}

export function TagPicker({ value, onChange }: { value: ProfileTag[]; onChange: (tags: ProfileTag[]) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TagCategory>();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [visibleCount, setVisibleCount] = useState(8);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('✨');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const resultList = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = new Set(value.flatMap(tag => tag.kind === 'catalog' ? [tag.code] : []));
  const matches = searchTags(query, category, selected, tag => tagName(tag.code, tag.label));
  const results = matches.slice(0, visibleCount);
  const limitReached = value.length >= maxProfileTags;
  const activeOption = open && active >= 0 && active < results.length ? `${listId}-${results[active].code}` : undefined;

  useEffect(() => {
    if (activeOption) resultList.current?.querySelector(`[id="${CSS.escape(activeOption)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeOption]);
  useEffect(() => { setVisibleCount(8); }, [query, category]);
  function add(code: string) {
    if (limitReached || selected.has(code)) return;
    onChange([...value, { kind: 'catalog', code }]);
    setQuery(''); setActive(-1); input.current?.focus();
  }
  function createTag() {
    setLabel(query.trim().slice(0, 40)); setEmoji('✨'); setInvalid(false); setOpen(false); setAdding(true);
  }
  function closeCreator() {
    setAdding(false);
    requestAnimationFrame(() => { input.current?.focus(); setOpen(false); });
  }
  return <>
    <div className="interest-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); } }}>
      {!!value.length && <div className="tag-list selected-tags" aria-label={t('tags.selected')}>
        {value.map(tag => {
          const item = tagDisplay(tag);
          return <button type="button" key={tagKey(tag)} className="tag-pill tag-choice selected" aria-label={t('common.remove', { name: item.label })}
            onClick={() => onChange(value.filter(item => tagKey(item) !== tagKey(tag)))}><PixelEmoji emoji={item.emoji} />{item.label}<X size={12} /></button>;
        })}
      </div>}
      <div className={`tag-search ${open ? 'is-open' : ''}`}>
        <Search size={18} aria-hidden="true" />
        <input ref={input} role="combobox" aria-label={t('tags.search')} aria-expanded={open} aria-controls={open ? listId : undefined} aria-autocomplete="list" aria-activedescendant={activeOption}
          value={query} placeholder={t('tags.placeholder')} autoComplete="off" onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onChange={event => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true);
              setActive(index => event.key === 'ArrowDown' ? Math.min(index + 1, results.length - 1) : index < 0 ? results.length - 1 : Math.max(0, index - 1));
            } else if (event.key === 'Enter' && open && results.length) { event.preventDefault(); add(results[active >= 0 ? active : 0].code); }
            else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); }
          }} />
        {query && <button type="button" className="icon-button" aria-label={t('tags.clear')} onClick={() => { setQuery(''); setActive(-1); requestAnimationFrame(() => input.current?.focus()); }}><X size={16} /></button>}
      </div>
      {open && <div className="tag-search-panel">
        <div className="tag-categories" role="group" aria-label={t('tags.topics')}>
          <button type="button" aria-pressed={!category} onClick={() => { setCategory(undefined); setActive(-1); }}>{t('tags.all')}</button>
          {tagCategories.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => { setCategory(item); setActive(-1); }}>{t(`tags.category.${item}`)}</button>)}
        </div>
        <div ref={resultList} id={listId} role="listbox" aria-label={t('tags.results')} className="tag-results">
          {results.map((tag, index) => <button type="button" role="option" tabIndex={-1} id={`${listId}-${tag.code}`} key={tag.code} aria-selected={active === index}
            aria-label={tagName(tag.code, tag.label)} aria-disabled={limitReached} className={`tag-result ${active === index ? 'active' : ''}`}
            onMouseDown={event => event.preventDefault()} onClick={() => add(tag.code)}>
            <PixelEmoji emoji={tag.emoji} /><span>{tagName(tag.code, tag.label)}</span><small>{t(`tags.category.${tag.category}`)}</small><Plus size={15} aria-hidden="true" />
          </button>)}
        </div>
        {!results.length && <p className="tag-empty">{t('tags.noResults')}</p>}
        <div className="tag-search-footer"><span aria-live="polite">{t('tags.resultCount', { shown: results.length, count: matches.length })}</span>
          {matches.length > results.length && <button type="button" className="text-button" onClick={() => setVisibleCount(count => count + 8)}>{t('tags.more')}</button>}
          <button type="button" className="text-button" disabled={limitReached} onClick={createTag}><Plus size={14} />{t('bio.addTag')}</button></div>
      </div>}
      {limitReached && <p className="hint tag-limit">{t('tags.limit', { count: maxProfileTags })}</p>}
    </div>
    {adding && <Modal title={t('bio.customTitle')} onClose={closeCreator}>
      <form onSubmit={event => {
        event.preventDefault();
        const parsed = tagSchema.safeParse({ kind: 'custom', label, emoji, locale: getLocale() });
        if (!parsed.success || limitReached) { setInvalid(true); return; }
        if (!value.some(tag => tagKey(tag) === tagKey(parsed.data))) onChange([...value, parsed.data]);
        setQuery(''); setActive(-1); closeCreator();
      }}>
        <div className="custom-tag-fields"><label>{t('bio.customEmoji')}<input value={emoji} onChange={e => setEmoji(e.target.value)} className="emoji-input" required /></label>
          <label>{t('bio.customLabel')}<input value={label} onChange={e => setLabel(e.target.value)} placeholder={t('bio.customPlaceholder')} maxLength={40} required autoFocus /></label></div>
        {invalid && <p className="field-error" role="alert">{t('error.INVALID_INPUT')}</p>}
        <div className="modal-actions"><button type="button" className="text-button" onClick={closeCreator}>{t('common.cancel')}</button><button type="submit" className="pixel-button small">{t('bio.customSave')}<Plus size={16} /></button></div>
      </form>
    </Modal>}
  </>;
}
