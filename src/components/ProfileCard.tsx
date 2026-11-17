import type { Profile } from '../../shared/schema.ts';
import type { ContentSpan } from '../../shared/content-policy.ts';
import { PenLine } from 'lucide-react';
import { getLocale, t } from '../i18n.ts';
import { communities } from '../../shared/communities.ts';
import { Character } from './Character.tsx';
import { TagPills } from './Tags.tsx';
import { Markdown } from './Markdown.tsx';
import { SpokenLanguages } from './Discovery.tsx';
export function ProfileCard({ profile, flagged }: { profile: Profile; flagged?: ContentSpan[] }) {
  return <article className="profile-card paper-card"><div className="profile-banner"><span className="pixel-spark" /><span>{t('profile.badge')}</span><span className="banner-stars">✧ · ✦</span></div>
    <div className="profile-identity"><Character id={profile.avatarId} appearance={profile.avatarAppearance} /><div><h2 dir="auto">{profile.displayName}</h2><SpokenLanguages codes={profile.spokenLanguages} />{!!profile.tags.length && <TagPills items={profile.tags} />}{!!profile.communities?.length && <div className="community-badges" aria-label={t('communities.label')}>{profile.communities.map(id => { const community = communities.find(item => item.id === id); return community ? <span className="community-badge" key={id} title={t('communities.verified')}>✦ {community.name[getLocale()]}</span> : null; })}</div>}</div></div>
    <div className="profile-body">{profile.introMarkdown.trim() ? <Markdown content={profile.introMarkdown} flagged={flagged} /> : <div className="empty-bio"><PenLine size={22} /><p>{t('profile.noBio')}</p></div>}</div>
    {!!profile.askMeTopics.length && <div className="profile-ask-me"><h3>{t('askMe.title')}</h3><ul>{profile.askMeTopics.map(topic => <li key={topic} dir="auto">{topic}</li>)}</ul></div>}

  </article>;
}
