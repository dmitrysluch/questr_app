import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { t } from '../i18n.ts';
import type { ContentReview } from '../../shared/content-policy.ts';
import { ContentWarning, MarkedText } from './ContentReview.tsx';

export function AskMeTopics({ value, onChange, reviews = [] }: { value: string[]; onChange: (topics: string[]) => void; reviews?: ContentReview[] }) {
  const [input, setInput] = useState('');
  const normalized = input.trim().normalize('NFKC').toLocaleLowerCase();
  const canAdd = input.trim().length >= 5 && input.trim().length <= 160 && value.length < 3 && !value.some(topic => topic.normalize('NFKC').toLocaleLowerCase() === normalized);
  function add(event: FormEvent) {
    event.preventDefault();
    if (!canAdd) return;
    onChange([...value, input.trim()]); setInput('');
  }
  return <section className="ask-me-editor" aria-label={t('askMe.title')}>
    <div className="section-heading"><h2>{t('askMe.title')}</h2><span>{t('common.optional')} · {value.length}/3</span></div>
    {value.length > 0 && <ul className="ask-me-list">{value.map((topic, index) => <li key={`${topic}:${index}`}>
      <span dir="auto"><MarkedText text={topic} spans={reviews[index]?.spans} /></span>
      <button type="button" aria-label={t('common.remove', { name: topic })} onClick={() => onChange(value.filter((_, i) => i !== index))}><X size={15} /></button>
      <ContentWarning text={topic} review={reviews[index]} />
    </li>)}</ul>}
    {value.length < 3 && <form className="ask-me-form" onSubmit={add}>
      <input aria-label={t('askMe.input')} placeholder={t('askMe.placeholder')} value={input} onChange={event => setInput(event.target.value)} maxLength={160} />
      <button className="outline-button small" type="submit" disabled={!canAdd}><Plus size={15} />{t('askMe.add')}</button>
    </form>}
  </section>;
}
