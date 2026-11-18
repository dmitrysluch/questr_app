import { test } from 'node:test';
import assert from 'node:assert/strict';
import { communities, communityAncestors, parseCommunities } from '../shared/communities.ts';

const named = (id: string, parentId: string | null) => ({ id, parentId, name: { en: id, ru: id } });

test('checked-in community catalog keeps its existing ancestry', () => {
  assert.ok(communities.some(community => community.id === 'ariel_students'));
  assert.deepEqual(communityAncestors('ariel_students'),
    ['ariel_students', 'israeli_university_students', 'university_students']);
});

test('JSON community catalog orders parents first and rejects ambiguous or broken hierarchies', () => {
  assert.deepEqual(parseCommunities({ communities: [named('child', 'root'), named('root', null)] }).map(item => item.id), ['root', 'child']);
  assert.throws(() => parseCommunities({ communities: [named('root', null), named('root', null)] }), /Duplicate community/);
  assert.throws(() => parseCommunities({ communities: [named('child', 'missing')] }), /Unknown parent community/);
  assert.throws(() => parseCommunities({ communities: [named('first', 'second'), named('second', 'first')] }), /cycle/);
});
