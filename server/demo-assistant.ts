import type { ChatMessage, ProposalOutput } from '../shared/schema.ts';
import type { Locale } from '../shared/locale.ts';

// Offline fixtures only. Connected interviews never use this question list or composer.
export function demoQuestion(messages: ChatMessage[], bio: string, locale: Locale = 'en'): string {
  const last = messages.filter(m => m.role === 'user').at(-1)?.content.toLowerCase() ?? bio.toLowerCase();
  const asked = new Set(messages.filter(m => m.role === 'assistant').map(m => m.content));
  if (locale === 'ru') {
    const questions: [RegExp, string][] = [
      [/скал|боулдер|climb|boulder/, 'Что тебе нравится в скалолазании?'],
      [/кофе|coffee|espresso/, 'Какой кофе тебе особенно нравится?'],
      [/кино|фильм|film|cinema/, 'Какое кино тебе хочется обсудить с кем-то?'],
      [/музык|техно|music|edm/, 'Какая музыка тебе нравится сейчас?'],
    ];
    if (messages.at(-1)?.kind === 'change_topic') return questions.map(([, question]) => question).find(question => !asked.has(question)) ?? 'Как ты любишь проводить время с друзьями?';
    for (const [pattern, question] of questions) if (pattern.test(last) && !asked.has(question)) return question;
    return ['Чем тебе было приятно заняться на этой неделе?', 'Что в этом тебе нравится?', 'Что бы ты хотел(-а) попробовать с новым знакомым?'].find(question => !asked.has(question)) ?? 'О чём тебе хочется рассказать подробнее?';
  }
  const questions: [RegExp, string][] = [
    [/climb|boulder/, 'What was one fun moment from your last climbing session?'],
    [/coffee|espresso|cafe/, 'Where did you last have a really good coffee?'],
    [/film|cinema|arthouse|movie/, 'What was the last film you wanted to tell someone about?'],
    [/music|edm|techno|concert/, 'What have you been listening to this week?'],
  ];
  if (messages.at(-1)?.kind === 'change_topic') return questions.map(([, question]) => question).find(question => !asked.has(question)) ?? 'What kind of company do you enjoy?';
  if (!/^please skip/i.test(last)) for (const [pattern, question] of questions) if (pattern.test(last) && !asked.has(question)) return question;
  return ['What is something you enjoyed doing this week?', 'What happened the last time you did that?', 'What would you like to try with a new friend?'].find(q => !asked.has(q)) ?? 'Which part would you like to tell me more about?';
}
export function demoProposal(messages: ChatMessage[], bio: string, locale: Locale = 'en'): ProposalOutput {
  const answers = messages.filter(m => m.role === 'user' && m.kind !== 'change_topic' && m.contentReview?.status !== 'blocked' && m.content.trim().split(/\s+/).length > 2 && !/^(please\s+)?(skip\b|ask\b|next question|another question|thanks\b|thank you\b)/i.test(m.content.trim()) && !bio.includes(m.content));
  return {
    introMarkdown: [bio, ...answers.map(m => m.content)].filter(Boolean).join('\n\n'),
    changeSummary: locale === 'ru' ? bio ? 'Существующее био сохранено, новые ответы добавлены. Офлайн-демо не переписывает текст.' : 'Ответы собраны в черновик. Офлайн-демо не переписывает текст.' : bio ? 'Kept your existing bio and added your new answers. This offline demo does not rewrite prose.' : 'Collected your answers into a draft. This offline demo does not rewrite prose.',
    sourceIds: [...(bio.trim() ? ['bio'] : []), ...answers.map(m => m.id)], suggestedTags: [], suggestedAskMeTopics: [],
  };
}
