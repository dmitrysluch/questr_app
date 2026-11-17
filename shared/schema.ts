import { z } from 'zod';
import { avatars, tags } from './catalog.ts';
import type { BioReview, ContentReview } from './content-policy.ts';
import { spokenLanguagesSchema, type DiscoveryPreferences } from './discovery.ts';
import { supportedLocales } from './locale.ts';
import { avatarAppearanceSchema, type AvatarAppearance } from './avatar.ts';

export const localeSchema = z.enum(supportedLocales);
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
export const maxProfileTags = 30;
export const selectedTagsSchema = z.array(tagSchema).max(maxProfileTags).refine(items => new Set(items.map(tagKey)).size === items.length, 'Tags must be unique');
export const askMeTopicSchema = z.string().trim().min(5).max(160);
export const askMeTopicsSchema = z.array(askMeTopicSchema).max(3).refine(items =>
  new Set(items.map(item => item.normalize('NFKC').toLocaleLowerCase())).size === items.length, 'Topics must be unique');
export const draftInputSchema = z.object({
  revision: z.number().int().nonnegative(),
  displayName: z.string().trim().min(2).max(40),
  avatarId: z.string().refine(id => avatars.some(a => a.id === id)).nullable(),
  avatarAppearance: avatarAppearanceSchema.nullable().default(null),
  introMarkdown: z.string(),
  tags: selectedTagsSchema,
  askMeTopics: askMeTopicsSchema.default([]),
  spokenLanguages: spokenLanguagesSchema.default([]),
  openToRomance: z.boolean().default(false),
  mode: z.enum(['manual', 'interview']),
  currentStep: z.enum(['avatar', 'bio', 'discovery', 'review']),
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
  suggestedAskMeTopics: z.array(z.object({ text: askMeTopicSchema, sourceId: z.string() }).strict()).max(3),
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
  suggestedAskMeTopics: { text: string; sourceId: string }[];
  sourceIds: string[];
  status: 'pending' | 'accepted' | 'rejected';
}
export interface Profile {
  displayName: string; avatarId: string; avatarAppearance: AvatarAppearance | null; introMarkdown: string;
  tags: ProfileTag[]; askMeTopics: string[]; spokenLanguages: string[]; revision: number; completedAt: string;
}
export interface AppState {
  user: { id: string; status: 'pending_invite' | 'onboarding' | 'active' | 'blocked'; locale: string };
  permissions: { admin: boolean; inviteCreate: boolean };
  draft: Draft | null;
  profile: Profile | null;
  conversation: Conversation | null;
  proposal: Proposal | null;
  demoInvite: string | null;
  bioReview: BioReview | null;
  discovery: DiscoveryPreferences;
}
export interface InviteRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'redeemed' | 'expired' | 'revoked';
  createdBy: string | null;
  redeemedBy: string | null;
  eventCreator: boolean;
  inviteDepth: number;
}
export interface InviteBudget { maxUses: number; used: number; windowDays: number }
export interface InviterAccount {
  id: string; displayName: string; isAdmin: boolean; isInviter: boolean; inviteDepth: number; isEventCreator: boolean;
  budget: InviteBudget | null;
  eventBudget: InviteBudget | null;
}
export interface AppConfig { authMode: 'demo' | 'telegram'; aiMode: 'demo' | 'openrouter'; botUsername: string; termsVersion: string; googleMapsBrowserKey: string }
