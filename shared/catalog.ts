export const avatars = [
  ['sprout', 'Sprout', '#e0e5d2'], ['ember', 'Ember', '#f0d9cc'],
  ['moss', 'Moss', '#dbe2cf'], ['cloud', 'Cloud', '#dce3e7'],
  ['maple', 'Maple', '#ead9c4'], ['dusk', 'Dusk', '#ddd8e7'],
  ['sunny', 'Sunny', '#f0e3bb'], ['river', 'River', '#d4e3e0'],
  ['olive', 'Olive', '#e1e0ca'], ['plum', 'Plum', '#e5d8e2'],
  ['cedar', 'Cedar', '#e2d6cb'], ['coral', 'Coral', '#eed7cc'],
].map(([id, name, background]) => ({ id, name, background, asset: `/avatars/${id}.svg` }));

export const tags = [
  { code: 'programming', emoji: '🧑‍💻', label: 'Programmer', keywords: ['programming', 'programmer', 'coding', 'software'] },
  { code: 'indoor_climbing', emoji: '🧗', label: 'Indoor climbing', keywords: ['climbing', 'bouldering', 'climb'] },
  { code: 'arthouse_cinema', emoji: '🎬', label: 'Arthouse cinema', keywords: ['arthouse', 'art-house', 'art house'] },
  { code: 'edm', emoji: '🎧', label: 'EDM', keywords: ['edm', 'electronic music', 'techno'] },
  { code: 'coffee', emoji: '☕', label: 'Coffee', keywords: ['coffee', 'espresso', 'cafe'] },
  { code: 'board_games', emoji: '🎲', label: 'Board games', keywords: ['board games', 'board game', 'tabletop'] },
  { code: 'hiking', emoji: '🥾', label: 'Hiking', keywords: ['hiking', 'hike', 'trails'] },
  { code: 'books', emoji: '📚', label: 'Books', keywords: ['reading', 'books', 'novels'] },
  { code: 'cooking', emoji: '🍳', label: 'Cooking', keywords: ['cooking', 'cook', 'baking'] },
  { code: 'photography', emoji: '📷', label: 'Photography', keywords: ['photography', 'photos', 'camera'] },
  { code: 'live_music', emoji: '🎸', label: 'Live music', keywords: ['concerts', 'live music', 'gigs'] },
  { code: 'art', emoji: '🎨', label: 'Art & making', keywords: ['painting', 'drawing', 'pottery', 'crafts'] },
] as const;

export const termsVersion = '2026-11-11';
export const aiConsentVersion = '2026-11-11-adaptive-v2';
