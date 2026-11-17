import { z } from 'zod';

export const romanceCategories = ['woman', 'man', 'nonbinary', 'another_gender'] as const;
export const romanceCategorySchema = z.enum(romanceCategories);
export type RomanceCategory = z.infer<typeof romanceCategorySchema>;
export const romanceConsentVersion = 'romance-v1';
export const romanceInputSchema = z.object({
  revision: z.number().int().nonnegative(),
  gender: romanceCategorySchema,
  interestedIn: z.array(romanceCategorySchema).min(1).max(romanceCategories.length)
    .refine(items => new Set(items).size === items.length, 'Choose each category once'),
  consent: z.literal(true),
}).strict();
export interface RomanceSettings {
  enabled: boolean;
  gender: RomanceCategory | null;
  interestedIn: RomanceCategory[];
  revision: number;
  consentVersion: string | null;
}
