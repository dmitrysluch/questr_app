import type { Profile } from '../../shared/schema.ts';
import type { ContentSpan } from '../../shared/content-policy.ts';
import { PenLine } from 'lucide-react';
import { t } from '../i18n.ts';
import { Character } from './Character.tsx';
import { TagPills } from './Tags.tsx';
import { Markdown } from './Markdown.tsx';
import { SpokenLanguages } from './Discovery.tsx';
export function ProfileCard({ profile, flagged }: { profile: Profile; flagged?: ContentSpan[] }) {
  return <article className="profile-card paper-card"><div className="profile-banner"><span className="pixel-spark" /><span>{t('profile.badge')}</span><span className="banner-stars">✧ · ✦</span></div>
    <div className="profile-identity"><Character id={profile.avatarId} /><div><h2 dir="auto">{profile.displayName}</h2><SpokenLanguages codes={profile.spokenLanguages} />{!!profile.tags.length && <TagPills items={profile.tags} />}</div></div>
    <div className="profile-body">{profile.introMarkdown.trim() ? <Markdown content={profile.introMarkdown} flagged={flagged} /> : <div className="empty-bio"><PenLine size={22} /><p>{t('profile.noBio')}</p></div>}</div>

  </article>;
}
