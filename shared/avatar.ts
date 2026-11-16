import { z } from 'zod';

export const skinTones = ['porcelain', 'light', 'warm', 'olive', 'brown', 'deep'] as const;
// Keep older saved appearances readable; new characters use one shared shape.
const legacySilhouettes = ['masculine', 'feminine', 'androgynous'] as const;
export const hairStyles = ['buzz', 'short', 'bob', 'long', 'bangs', 'curly', 'ponytail', 'shaved'] as const;
export const hairColors = ['black', 'brown', 'blonde', 'ginger', 'silver', 'pink', 'blue', 'purple'] as const;
export const tops = ['rust_tee', 'sage_tee', 'cream_sweater', 'blue_sweater', 'plum_hoodie', 'dark_jacket'] as const;
export const headwear = ['none', 'beanie', 'headband', 'headphones'] as const;

export const avatarAppearanceSchema = z.object({
  skinTone: z.enum(skinTones),
  silhouette: z.enum(legacySilhouettes),
  hairStyle: z.enum(hairStyles),
  hairColor: z.enum(hairColors),
  top: z.enum(tops),
  headwear: z.enum(headwear),
  earrings: z.boolean(),
}).strict();
export type AvatarAppearance = z.infer<typeof avatarAppearanceSchema>;

export const defaultAppearance: AvatarAppearance = {
  skinTone: 'warm', silhouette: 'feminine', hairStyle: 'short', hairColor: 'brown',
  top: 'sage_tee', headwear: 'none', earrings: false,
};

// Old profile rows can have a null appearance; Character renders their preset
// look using the same geometry as newly customized avatars.
const presetLooks: Partial<Record<string, Partial<AvatarAppearance>>> = {
  sprout: { skinTone: 'light', hairStyle: 'short', hairColor: 'brown', top: 'sage_tee' },
  ember: { skinTone: 'warm', hairStyle: 'curly', hairColor: 'ginger', top: 'rust_tee' },
  moss: { skinTone: 'warm', hairStyle: 'short', hairColor: 'brown', top: 'sage_tee', headwear: 'beanie' },
  cloud: { skinTone: 'porcelain', hairStyle: 'bob', hairColor: 'silver', top: 'blue_sweater' },
  maple: { skinTone: 'brown', hairStyle: 'long', hairColor: 'black', top: 'cream_sweater' },
  dusk: { skinTone: 'deep', hairStyle: 'buzz', hairColor: 'black', top: 'plum_hoodie' },
  sunny: { skinTone: 'light', hairStyle: 'bangs', hairColor: 'blonde', top: 'rust_tee' },
  river: { skinTone: 'olive', hairStyle: 'ponytail', hairColor: 'blue', top: 'blue_sweater' },
  olive: { skinTone: 'olive', hairStyle: 'curly', hairColor: 'brown', top: 'dark_jacket' },
  plum: { skinTone: 'warm', hairStyle: 'bob', hairColor: 'purple', top: 'plum_hoodie', earrings: true },
  cedar: { skinTone: 'brown', hairStyle: 'long', hairColor: 'black', top: 'dark_jacket' },
  coral: { skinTone: 'light', hairStyle: 'bangs', hairColor: 'pink', top: 'cream_sweater' },
};
export function appearanceForPreset(id: string | null): AvatarAppearance {
  return { ...defaultAppearance, ...(id ? presetLooks[id] : null) };
}
export function isPresetAppearance(id: string | null, appearance: AvatarAppearance | null): boolean {
  if (!appearance) return true;
  const preset = appearanceForPreset(id);
  return (Object.keys(preset) as (keyof AvatarAppearance)[]).every(key => key === 'silhouette' || appearance[key] === preset[key]);
}
