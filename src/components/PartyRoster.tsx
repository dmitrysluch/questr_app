import { useState } from 'react';
import type { EventPerson } from '../../shared/events.ts';
import { t } from '../i18n.ts';
import { Character } from './Character.tsx';
import { PixelEmoji } from './PixelEmoji.tsx';
import { tagDisplay } from './Tags.tsx';

export function PartyRoster({ people, busy, canManage, onProfile, onRemove }: {
  people: EventPerson[]; busy: boolean; canManage: boolean;
  onProfile: (id: string) => void; onRemove: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = people.find(person => person.id === selectedId && !person.unavailable && person.askMeTopics.length > 0);
  return <section className="party-section">
    <h2>{t('events.party')}</h2>
    <div className="party-grid">
      {people.map(person => <div className="party-person" key={person.id}>
        <div className="party-matches">
          {person.matchingTags.slice(0, person.romanceMatch ? 2 : 3).map(tag => {
            const { label, emoji } = tagDisplay(tag);
            const tooltip = t('events.sharedTag', { name: label });
            return <span key={tag.kind === 'catalog' ? tag.code : tag.label} className="party-match" role="img" aria-label={tooltip} title={tooltip} tabIndex={0}><PixelEmoji emoji={emoji} /></span>;
          })}
          {person.romanceMatch && <span className="party-match" role="img" aria-label={t('events.romanceMatch')} title={t('events.romanceMatch')} tabIndex={0}><PixelEmoji emoji="💗" /></span>}
        </div>
        <button className="person-button" disabled={busy || person.unavailable} aria-label={t('events.viewCharacter', { name: person.displayName })} onClick={() => onProfile(person.id)}>
          <Character id={person.avatarId} appearance={person.avatarAppearance} />
          <span className="party-name" dir="auto">{person.displayName}</span>
        </button>
        {person.role === 'host' && <span className="party-role">{t('events.hostBadge')}</span>}
        {person.unavailable && <small className="unavailable-character">{t('events.unavailable')}</small>}
        {!!person.askMeTopics.length && !person.unavailable && <button className="party-ask-button" aria-expanded={selected?.id === person.id} aria-controls={selected?.id === person.id ? 'party-ask-topics' : undefined} onClick={() => setSelectedId(selected?.id === person.id ? null : person.id)}>{t('askMe.title')}</button>}
        {canManage && person.role !== 'host' && <button className="text-button party-remove" disabled={busy} onClick={() => onRemove(person.id)}>{t('events.remove')}</button>}
      </div>)}
    </div>
    {selected && <div className="party-ask-topics" id="party-ask-topics"><h3>{t('events.askMeFrom', { name: selected.displayName })}</h3><ul>{selected.askMeTopics.map(topic => <li key={topic} dir="auto">{topic}</li>)}</ul></div>}
  </section>;
}
