import type { Profile } from '../../shared/schema.ts';
import type { ContentSpan } from '../../shared/content-policy.ts';
import { PenLine } from 'lucide-react';
import { t } from '../i18n.ts';
import { Character } from './Character.tsx';
import { TagPills } from './Tags.tsx';
import { Markdown } from './Markdown.tsx';
import { SpokenLanguages } from './Discovery.tsx';
export function ProfileCard({ profile, flagged, onRomanceToggle, busy = false }: { profile: Profile; flagged?: ContentSpan[]; onRomanceToggle?: () => void; busy?: boolean }) {
  return <article className="profile-card paper-card"><div className="profile-banner"><span className="pixel-spark" /><span>{t('profile.badge')}</span><span className="banner-stars">✧ · ✦</span></div>
    <div className="profile-identity"><Character id={profile.avatarId} /><div><h2 dir="auto">{profile.displayName}</h2><SpokenLanguages codes={profile.spokenLanguages} />{!!profile.tags.length && <TagPills items={profile.tags} />}{(profile.openToRomance || onRomanceToggle) && <div className="romance-control">{onRomanceToggle ? <button type="button" className={`romance-button ${profile.openToRomance ? 'active' : ''}`} aria-pressed={profile.openToRomance} disabled={busy} onClick={onRomanceToggle}>{t('profile.romance')}</button> : <span className="romance-badge">{t('profile.romance')}</span>}</div>}</div></div>
    <div className="profile-body">{profile.introMarkdown.trim() ? <Markdown content={profile.introMarkdown} flagged={flagged} /> : <div className="empty-bio"><PenLine size={22} /><p>{t('profile.noBio')}</p></div>}</div>

  </article>;
}
