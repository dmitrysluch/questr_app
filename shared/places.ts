import { z } from 'zod';
import { locationIdSchema } from './discovery.ts';

export const placeFieldsSchema = z.object({
  cityLocationId: locationIdSchema,
  name: z.string().trim().min(2).max(160),
  address: z.string().trim().min(3).max(240),
  active: z.boolean(),
}).strict();

export interface Place {
  id: string;
  cityLocationId: string;
  cityName: string;
  name: string;
  address: string;
  active: boolean;
  revision: number;
}
