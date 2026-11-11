import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { tags } from '../../shared/catalog.ts';
import { tagKey, tagSchema, type ProfileTag } from '../../shared/schema.ts';
import { t } from '../i18n.ts';
import { Modal } from './Modal.tsx';

export function tagDisplay(tag: ProfileTag) {
  if (tag.kind === 'custom') return { label: tag.label, emoji: tag.emoji };
  return tags.find(item => item.code === tag.code) ?? { label: tag.code, emoji: '✨' };
}
export function TagPills({ items }: { items: ProfileTag[] }) {
  return <div className="tag-list">{items.map(tag => {
    const item = tagDisplay(tag);
    return <span className="tag-pill" key={tagKey(tag)}><span aria-hidden="true">{item.emoji}</span>{item.label}</span>;
  })}</div>;
}
export function TagPicker({ value, onChange }: { value: ProfileTag[]; onChange: (tags: ProfileTag[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('✨');
  const [invalid, setInvalid] = useState(false);
  function toggle(tag: ProfileTag) {
    const key = tagKey(tag);
    onChange(value.some(t => tagKey(t) === key) ? value.filter(t => tagKey(t) !== key) : [...value, tag]);
  }
  return <>
    <div className="tag-list tag-picker">
      {tags.map(tag => {
        const selected = value.some(t => t.kind === 'catalog' && t.code === tag.code);
        return <button type="button" key={tag.code} className={`tag-pill tag-choice ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => toggle({ kind: 'catalog', code: tag.code })}>
          <span aria-hidden="true">{tag.emoji}</span>{tag.label}{selected && <Check size={13} />}
        </button>;
      })}
      {value.filter(tag => tag.kind === 'custom').map(tag => {
        const display = tagDisplay(tag);
        return <button type="button" key={tagKey(tag)} className="tag-pill tag-choice selected" aria-label={t('common.remove', { name: display.label })} onClick={() => toggle(tag)}><span aria-hidden="true">{display.emoji}</span>{display.label}<X size={13} /></button>;
      })}
      <button type="button" className="tag-pill add-tag" onClick={() => { setAdding(true); setInvalid(false); }}><Plus size={15} />{t('bio.addTag')}</button>
    </div>
    {adding && <Modal title={t('bio.customTitle')} onClose={() => setAdding(false)}>
      <form onSubmit={event => {
        event.preventDefault();
        const parsed = tagSchema.safeParse({ kind: 'custom', label, emoji, locale: 'en' });
        if (!parsed.success || value.length >= 30) { setInvalid(true); return; }
        if (!value.some(tag => tagKey(tag) === tagKey(parsed.data))) onChange([...value, parsed.data]);
        setAdding(false); setLabel(''); setEmoji('✨');
      }}>
        <div className="custom-tag-fields"><label>{t('bio.customEmoji')}<input value={emoji} onChange={e => setEmoji(e.target.value)} className="emoji-input" required /></label>
          <label>{t('bio.customLabel')}<input value={label} onChange={e => setLabel(e.target.value)} placeholder={t('bio.customPlaceholder')} maxLength={40} required autoFocus /></label></div>
        {invalid && <p className="field-error" role="alert">{t('error.INVALID_INPUT')}</p>}
        <div className="modal-actions"><button type="button" className="text-button" onClick={() => setAdding(false)}>{t('common.cancel')}</button><button type="submit" className="pixel-button small">{t('bio.customSave')}<Plus size={16} /></button></div>
      </form>
    </Modal>}
  </>;
}
