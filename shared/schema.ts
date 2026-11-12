import { z } from 'zod';
import { avatars, tags } from './catalog.ts';
import type { BioReview, ContentReview } from './content-policy.ts';

export const localeSchema = z.literal('en');
const emojiSchema = z.string().min(1).max(32).refine(value => {
  const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)];
  return graphemes.length === 1 && /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(value);
}, 'Choose a single emoji');
export const tagSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog'), code: z.string().refine(code => tags.some(t => t.code === code)) }).strict(),
  z.object({ kind: z.literal('custom'), label: z.string().trim().min(1).max(40), emoji: emojiSchema, locale: localeSchema }).strict(),
]);
export type ProfileTag = z.infer<typeof tagSchema>;
export const tagKey = (tag: ProfileTag) => tag.kind === 'catalog' ? `catalog:${tag.code}` : `custom:${tag.label.trim().normalize('NFKC').toLocaleLowerCase('en')}`;
export const selectedTagsSchema = z.array(tagSchema).max(30).refine(items => new Set(items.map(tagKey)).size === items.length, 'Tags must be unique');
export const draftInputSchema = z.object({
  revision: z.number().int().nonnegative(),
  displayName: z.string().trim().min(2).max(40),
  avatarId: z.string().refine(id => avatars.some(a => a.id === id)).nullable(),
  introMarkdown: z.string(),
  tags: selectedTagsSchema,
  mode: z.enum(['manual', 'interview']),
  currentStep: z.enum(['avatar', 'bio', 'review']),
}).strict();
export type Draft = z.infer<typeof draftInputSchema>;
export const registerSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  invite: z.string().trim().min(6).max(120),
  adult: z.literal(true),
  terms: z.literal(true),
  locale: localeSchema,
}).strict();
export const messageSchema = z.union([z.object({
  requestId: z.uuid(),
  content: z.string().trim().min(1).max(12000),
}).strict(), z.object({ requestId: z.uuid(), action: z.literal('change_topic') }).strict()]);
export type InterviewInput = z.infer<typeof messageSchema>;
export const proposalOutputSchema = z.object({
  introMarkdown: z.string().min(1).refine(value => Boolean(value.trim())),
  changeSummary: z.string().trim().min(1).max(1500),
  sourceIds: z.array(z.string()).min(1),
  suggestedTags: z.array(z.object({ code: z.string(), sourceId: z.string() }).strict()).max(12),
}).strict();
export type ProposalOutput = z.infer<typeof proposalOutputSchema>;
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; kind?: 'text' | 'change_topic'; contentReview?: ContentReview | null }
export interface Conversation { id: string; mode: 'demo' | 'openrouter'; messages: ChatMessage[] }
export interface Proposal {
  id: string;
  introMarkdown: string;
  basedOnRevision: number;
  baseMarkdown: string;
  changeSummary: string;
  suggestedTags: { code: string; sourceId: string }[];
  sourceIds: string[];
  status: 'pending' | 'accepted' | 'rejected';
}
export interface Profile {
  displayName: string; avatarId: string; introMarkdown: string;
  tags: ProfileTag[]; revision: number; completedAt: string;
}
export interface AppState {
  user: { id: string; status: 'pending_invite' | 'onboarding' | 'active' | 'blocked'; locale: string };
  draft: Draft | null;
  profile: Profile | null;
  conversation: Conversation | null;
  proposal: Proposal | null;
  demoInvite: string | null;
  bioReview: BioReview | null;
}
export interface AppConfig { authMode: 'demo' | 'telegram'; aiMode: 'demo' | 'openrouter'; botUsername: string; termsVersion: string }
