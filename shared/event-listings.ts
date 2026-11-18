import { z } from 'zod';
import { locationIdSchema, type Location } from './discovery.ts';
import { timeZoneSchema, type Adventure } from './events.ts';
import type { Place } from './places.ts';

export const listingFieldsSchema = z.object({
  title: z.string().trim().min(3).max(160),
  descriptionMarkdown: z.string().trim().min(10).max(12000),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  timeZone: timeZoneSchema,
  cityLocationId: locationIdSchema.nullable(),
  placeId: z.uuid().nullable(),
  mapsUrl: z.string().trim().max(2048).nullable(),
  venueName: z.string().trim().max(160).nullable(),
  sourceUrl: z.string().trim().max(2048),
  organizerName: z.string().trim().min(2).max(160),
  communityId: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable(),
  status: z.enum(['draft', 'published', 'cancelled']),
}).strict().refine(input => Number(Boolean(input.placeId)) + Number(Boolean(input.mapsUrl)) === 1, 'Choose one venue')
  .refine(input => input.mapsUrl ? !!input.venueName && input.venueName.length >= 2 : input.venueName === null, 'Name the Google Maps venue');
export type ListingFields = z.infer<typeof listingFieldsSchema>;
export interface EventListing {
  id: string; title: string; descriptionMarkdown: string; startsAt: string; endsAt: string; timeZone: string;
  city: Location; place: Place | null; mapsUrl: string | null; venueName: string | null; sourceUrl: string; organizerName: string;
  communityId: string | null; status: 'draft' | 'published' | 'cancelled'; revision: number;
  lastCheckedAt: string | null; createdAt: string; updatedAt: string;
}
export interface EventListingDetail extends EventListing { adventures: Adventure[] }
