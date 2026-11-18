import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { communityAncestors, parseCommunities } from '../shared/communities.ts';
import { loadCommunityCatalog } from '../server/community-catalog.ts';

const named = (id: string, parentId: string | null) => ({ id, parentId, name: { en: id, ru: id } });

test('external community catalog keeps its existing ancestry', async () => {
  const communities = await loadCommunityCatalog(fileURLToPath(new URL('./fixtures/communities.json', import.meta.url)));
  assert.ok(communities.some(community => community.id === 'ariel_students'));
  assert.deepEqual(communityAncestors(communities, 'ariel_students'),
    ['ariel_students', 'israeli_university_students', 'university_students']);
  await assert.rejects(loadCommunityCatalog(fileURLToPath(new URL('./fixtures/missing-communities.json', import.meta.url))), /Cannot read community catalog/);
});

test('JSON community catalog orders parents first and rejects ambiguous or broken hierarchies', () => {
  assert.deepEqual(parseCommunities({ communities: [named('child', 'root'), named('root', null)] }).map(item => item.id), ['root', 'child']);
  assert.throws(() => parseCommunities({ communities: [named('root', null), named('root', null)] }), /Duplicate community/);
  assert.throws(() => parseCommunities({ communities: [named('child', 'missing')] }), /Unknown parent community/);
  assert.throws(() => parseCommunities({ communities: [named('first', 'second'), named('second', 'first')] }), /cycle/);
});
