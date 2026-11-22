import { useEffect, useState } from 'react';
import type { Profile } from '../../shared/schema.ts';
import { api } from '../api.ts';
import { errorText, t } from '../i18n.ts';
import { ProfileCard } from './ProfileCard.tsx';

export function AdminProfile({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    void api<{ profile: Profile }>(`/invites/admin/profiles/${userId}`).then(result => { if (active) setProfile(result.profile); }).catch(reason => { if (active) setError(reason); });
    return () => { active = false; };
  }, [userId]);
  return <section className="admin-profile"><a className="text-button" href="#invites">← {t('invites.backToRoles')}</a>
    <h1>{t('invites.userProfile')}</h1>
    {profile ? <ProfileCard profile={profile} /> : <p>{error ? errorText(error) : t('common.loading')}</p>}
  </section>;
}
