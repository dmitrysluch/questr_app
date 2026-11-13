export const contentPolicyVersion = 'explicit-content-v1';
export const profileContentPolicy = `QUESTR profiles must not contain explicitly sexual wording: graphic sexual descriptions, sexual acts described for arousal, explicit sexual invitations or requests, or sexual services.
Do not flag ordinary romance, dating, affection, sexual orientation or gender identity. Neutral, non-graphic mentions of sexual health, education, art or boundaries are also allowed. Judge the meaning and context, not the presence of a word like "sex". Apply the same rule across languages.
If explicit wording appears, do not elaborate on it, solicit details, repeat it, or disguise the same sexual proposition with euphemisms. Gently explain that profiles cannot contain explicit sexual messages and redirect to a nonsexual interest or everyday experience. Do not shame, diagnose or moralize about the person.`;
export const contentRedirectNotice = 'Please keep explicitly sexual messages out of your profile. We can focus on another part of your story.';
export interface ContentSpan { start: number; end: number }
export interface ContentReview { status: 'approved' | 'blocked'; spans: ContentSpan[] }
export interface BioReview extends ContentReview { introMarkdown: string; askMeTopics?: string[]; topicReviews?: ContentReview[] }
export function mergeSpans(spans: ContentSpan[]): ContentSpan[] {
  const merged: ContentSpan[] = [];
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}
