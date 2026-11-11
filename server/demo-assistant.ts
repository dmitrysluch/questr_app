import type { ChatMessage, ProposalOutput } from '../shared/schema.ts';

// Offline fixtures only. Connected interviews never use this question list or composer.
export function demoQuestion(messages: ChatMessage[], bio: string): string {
  const last = messages.filter(m => m.role === 'user').at(-1)?.content.toLowerCase() ?? bio.toLowerCase();
  const asked = new Set(messages.filter(m => m.role === 'assistant').map(m => m.content));
  const questions: [RegExp, string][] = [
    [/climb|boulder/, 'What was one fun moment from your last climbing session?'],
    [/coffee|espresso|cafe/, 'Where did you last have a really good coffee?'],
    [/film|cinema|arthouse|movie/, 'What was the last film you wanted to tell someone about?'],
    [/music|edm|techno|concert/, 'What have you been listening to this week?'],
  ];
  if (!/^please skip/i.test(last)) for (const [pattern, question] of questions) if (pattern.test(last) && !asked.has(question)) return question;
  return ['What is something you enjoyed doing this week?', 'What happened the last time you did that?', 'What would you like to try with a new friend?'].find(q => !asked.has(q)) ?? 'Which part would you like to tell me more about?';
}
export function demoProposal(messages: ChatMessage[], bio: string): ProposalOutput {
  const answers = messages.filter(m => m.role === 'user' && m.contentReview?.status !== 'blocked' && m.content.trim().split(/\s+/).length > 2 && !/^(please\s+)?(skip\b|ask\b|next question|another question|thanks\b|thank you\b)/i.test(m.content.trim()) && !bio.includes(m.content));
  return {
    introMarkdown: [bio, ...answers.map(m => m.content)].filter(Boolean).join('\n\n'),
    changeSummary: bio ? 'Kept your existing bio and added your new answers. This offline demo does not rewrite prose.' : 'Collected your answers into a draft. This offline demo does not rewrite prose.',
    sourceIds: [...(bio.trim() ? ['bio'] : []), ...answers.map(m => m.id)], suggestedTags: [],
  };
}
