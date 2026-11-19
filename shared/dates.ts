import { z } from 'zod';
import { languageCodeSchema, locationIdSchema } from './discovery.ts';
import { timeZoneSchema } from './events.ts';

export const dateConsentVersion = 'dates-v1';
export const datePeriodSchema = z.enum(['morning', 'day', 'evening']);
export const dateWindowSchema = z.object({ day: z.iso.date(), period: datePeriodSchema }).strict();
export const dateCreateSchema = z.object({
  requestId: z.uuid(), title: z.string().trim().min(3).max(100), description: z.string().trim().min(10).max(2000),
  locationId: locationIdSchema, languageCode: languageCodeSchema, communityId: z.string().nullable().default(null),
  timeZone: timeZoneSchema, costNote: z.string().trim().max(160).default(''), privatePlace: z.string().trim().max(1000).default(''),
  windows: z.array(dateWindowSchema).min(1).max(42),
}).strict();
export const dateResponseSchema = z.object({ requestId: z.uuid(), message: z.string().trim().min(20).max(300) }).strict();
export const dateReopenSchema = z.object({ requestId: z.uuid(), windows: z.array(dateWindowSchema).min(1).max(42) }).strict();
export type DateWindow = z.infer<typeof dateWindowSchema>;
export type DatePeriod = z.infer<typeof datePeriodSchema>;

export interface DateCard {
  id: string; roundId: string; title: string; description: string; locationId: string; locationName: string;
  languageCode: string; communityId: string | null; timeZone: string; costNote: string;
  status: 'open' | 'matched' | 'scheduled' | 'completed' | 'cancelled' | 'expired'; revision: number;
  owner: { id: string; displayName: string; introMarkdown: string; askMeTopics: string[] };
  windows: Array<DateWindow & { id: string }>;
  myResponse: { id: string; status: 'pending' | 'withdrawn' | 'declined' | 'matched' | 'closed_unmatched'; message: string } | null;
  isOwner: boolean; photoUrl: string | null; privatePlace: string | null;
}
export interface DateDetail extends DateCard {
  responses: Array<{ id: string; userId: string; displayName: string; introMarkdown: string; askMeTopics: string[]; message: string; status: string; photoUrl: string }>;
  match: null | { id: string; partnerId: string; partnerName: string; partnerPhotoUrl: string; votes: Record<string, string[]>;
    proposedWindowId: string | null; proposedBy: string | null; proposedStart: string | null; durationMinutes: number | null; confirmedAt: string | null;
    botUrl: string; botReady: boolean };
  messages: Array<{ id: string; senderId: string; body: string; createdAt: string }>;
}
