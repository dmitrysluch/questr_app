import { z } from 'zod';
import { languageCodeSchema, locationIdSchema, type Location } from './discovery.ts';
import type { Profile, ProfileTag } from './schema.ts';
import type { AvatarAppearance } from './avatar.ts';

export const timeZoneSchema = z.string().max(100).refine(zone => {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}, 'Invalid time zone');
export const eventFieldsSchema = z.object({
  title: z.string().trim().min(3).max(160),
  activitySummary: z.string().trim().max(240).default(''),
  descriptionMarkdown: z.string().trim().min(10).max(12000),
  district: z.string().trim().max(120),
  costEstimate: z.string().trim().min(2).max(120),
  experienceNotes: z.string().trim().min(2).max(240),
  onlinePlatform: z.string().trim().max(120).default(''),
  locationId: locationIdSchema,
  languageCode: languageCodeSchema,
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  timeZone: timeZoneSchema,
  capacity: z.number().int().min(2).max(50),
  meetingDetails: z.string().trim().max(2000).default(''),
  meetingMapUrl: z.string().max(2048).default(''),
}).strict();
export type EventFields = z.infer<typeof eventFieldsSchema>;
export const createEventSchema = eventFieldsSchema.extend({ requestId: z.uuid() });
export const editEventSchema = eventFieldsSchema.extend({ revision: z.number().int().nonnegative() });
export const applicationSchema = z.object({ message: z.string().trim().min(3).max(2000) }).strict();
export const connectionRequestSchema = z.object({
  purpose: z.enum(['chat', 'contact']),
  message: z.string().trim().min(3).max(3000),
}).strict();
export type CharacterConnection = { status: 'available' | 'pending' | 'incoming' | 'accepted' | 'closed' | 'unavailable'; botRequired: boolean; botUrl: string };
export function hasPublicLink(text: string): boolean {
  return /(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}\/)/i.test(text);
}
export type MemberStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'removed';
export interface EventPerson {
  id: string; displayName: string; avatarId: string; avatarAppearance: AvatarAppearance | null; role: 'host' | 'participant'; status: MemberStatus;
  unavailable?: boolean; applicationText?: string; matchingTags: ProfileTag[]; romanceMatch: boolean; askMeTopics: string[];
}
export interface Adventure {
  id: string; title: string; activitySummary: string; descriptionMarkdown: string; district: string; costEstimate: string;
  experienceNotes: string; onlinePlatform: string; recruitmentOpen: boolean; location: Location; languageCode: string;
  startsAt: string; endsAt: string; timeZone: string; capacity: number; participantCount: number; revision: number;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  host: Pick<EventPerson, 'id' | 'displayName' | 'avatarId' | 'avatarAppearance'>;
  myStatus: MemberStatus | null; isHost: boolean;
}
export interface AdventureDetail extends Adventure {
  meetingDetails: string | null; meetingMapUrl: string | null; reminderMinutes: 15 | 60 | 1440 | null;
  participants: EventPerson[]; applications: EventPerson[];
  canApply: boolean; canEdit: boolean; canManage: boolean; canChat: boolean;
  botUrl: string;
}
export interface AdventureList { events: Adventure[]; nextOffset: number | null }
export interface EventCreationAccess {
  hasRole: boolean;
  canCreate: boolean;
  budget: { maxUses: number; used: number; windowDays: number } | null;
}
export interface EventProfile { profile: Profile; connection: CharacterConnection }

export function wallTime(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Enumerate possible offsets rather than silently normalizing a missing/repeated
// DST time. Modern IANA offsets are multiples of 15 minutes, from -12 to +14.
export function wallTimeToInstant(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('EVENT_TIME_INVALID');
  timeZoneSchema.parse(timeZone);
  const center = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(center)) throw new Error('EVENT_TIME_INVALID');
  const matches: string[] = [];
  for (let minutes = -12 * 60; minutes <= 14 * 60; minutes += 15) {
    const instant = new Date(center - minutes * 60000).toISOString();
    if (wallTime(instant, timeZone) === local) matches.push(instant);
  }
  if (matches.length !== 1) throw new Error(matches.length ? 'EVENT_TIME_AMBIGUOUS' : 'EVENT_TIME_INVALID');
  return matches[0];
}
