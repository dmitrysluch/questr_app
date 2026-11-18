import { communities, type Community } from '../../shared/communities.ts';
import { getLocale, t } from '../i18n.ts';

function Branch({ community }: { community: Community }) {
  const children = communities.filter(item => item.parentId === community.id);
  return <li>
    <div className="admin-community-node"><span>{community.name[getLocale()]}</span><code>{community.id}</code></div>
    {children.length > 0 && <ul>{children.map(child => <Branch key={child.id} community={child} />)}</ul>}
  </li>;
}

export function AdminCommunities() {
  const roots = communities.filter(community => community.parentId === null);
  return <section className="admin-communities">
    <div className="page-heading"><span className="eyebrow">QUESTR / {t('nav.admin')}</span><h1>{t('communities.label')}</h1></div>
    <p className="hint">{t('communities.ancestryHint')}</p>
    <div className="paper-card admin-community-card"><ul aria-label={t('communities.label')}>{roots.map(root => <Branch key={root.id} community={root} />)}</ul></div>
  </section>;
}
