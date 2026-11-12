export const avatars = [
  ['sprout', 'Sprout', '#e0e5d2'], ['ember', 'Ember', '#f0d9cc'],
  ['moss', 'Moss', '#dbe2cf'], ['cloud', 'Cloud', '#dce3e7'],
  ['maple', 'Maple', '#ead9c4'], ['dusk', 'Dusk', '#ddd8e7'],
  ['sunny', 'Sunny', '#f0e3bb'], ['river', 'River', '#d4e3e0'],
  ['olive', 'Olive', '#e1e0ca'], ['plum', 'Plum', '#e5d8e2'],
  ['cedar', 'Cedar', '#e2d6cb'], ['coral', 'Coral', '#eed7cc'],
].map(([id, name, background]) => ({ id, name, background, asset: `/avatars/${id}.svg` }));

export { tags, tagCategories, type CatalogTag, type TagCategory } from './interests.ts';

export const termsVersion = '2026-11-11';
export const aiConsentVersion = '2026-11-11-adaptive-v2';
