import { preferredLocale, type Locale } from '../shared/locale.ts';

type Key = 'updated' | 'newApplication' | 'accepted' | 'declined' | 'removed' | 'left' | 'cancelled' | 'completed'
  | 'finishCharacter' | 'topicChatLive' | 'topicChatDemo' | 'topicPending' | 'topicApplyLive' | 'topicApplyDemo'
  | 'notAccepting' | 'chooseTopic' | 'applicationSent' | 'alreadyPending' | 'chatClosed' | 'botHelp'
  | 'applicationLength' | 'explicitContent' | 'noLinks' | 'messageLength' | 'unavailable' | 'processingFailed'
  | 'reminder' | 'openButton';

const copy: Record<Locale, Record<Key, string>> = {
  en: {
    updated: 'Adventure updated: {title}. Open QUESTR to check the latest time and meeting details.',
    newApplication: 'New application for {title}. Open QUESTR to read it and choose your party.',
    accepted: '{title}: you are in the party. Open QUESTR for meeting details and the party chat.',
    declined: '{title}: your application was declined.', removed: '{title}: you are no longer in this party.',
    left: 'A questr left {title}. Open QUESTR for the current party.',
    cancelled: '{title} was cancelled. The party chat is now closed; previous messages remain in your bot topic.',
    completed: '{title} was completed. The party chat is now closed; previous messages remain in your bot topic.',
    finishCharacter: 'Open QUESTR and finish your character before joining an adventure.',
    topicChatLive: '{title}\n\nMessages in this topic go to the accepted party under your QUESTR name. Your messages are sent through OpenRouter to check for explicit sexual content before delivery. Open QUESTR for meeting details.',
    topicChatDemo: '{title}\n\nMessages in this topic go to the accepted party under your QUESTR name. This local demo uses a limited content check. Open QUESTR for meeting details.',
    topicPending: '{title}\n\nYour application is waiting for the host.',
    topicApplyLive: '{title}\n\nWrite one short text message about this adventure to apply (3–2000 characters, no links or attachments). Your application is sent through OpenRouter to check for explicit sexual content before the host can read it.',
    topicApplyDemo: '{title}\n\nWrite one short text message about this adventure to apply (3–2000 characters, no links or attachments). This local demo uses a limited content check without an AI provider.',
    notAccepting: 'This adventure is not accepting applications.',
    chooseTopic: 'Open an adventure in QUESTR and use its bot button to choose a topic.',
    applicationSent: 'Application sent. The host will review your character and message.',
    alreadyPending: 'Your application is already waiting for the host.', chatClosed: 'This party chat is closed to you.',
    botHelp: 'Open an adventure in QUESTR, then use “Apply in bot” or “Open party chat”. Each adventure has its own private topic here.',
    applicationLength: 'Please write an application of 3–2000 characters.',
    explicitContent: 'Please keep explicit sexual content out of QUESTR messages. Try a message about the adventure instead.',
    noLinks: 'Please write your first message without links. You can ask the host about the adventure instead.',
    messageLength: 'Please keep each message under 3000 characters.',
    unavailable: 'This action is unavailable. Open QUESTR to check the adventure and your application.',
    processingFailed: 'Your message could not be processed. Please try again in a moment.',
    reminder: 'Reminder: {title} starts {time} ({zone}). Open QUESTR for the latest meeting details.',
    openButton: 'Open QUESTR',
  },
  ru: {
    updated: 'Вылазка «{title}» обновлена. Открой QUESTR, чтобы проверить время и детали встречи.',
    newApplication: 'Новая заявка на вылазку «{title}». Открой QUESTR, чтобы прочитать её и выбрать участников.',
    accepted: '«{title}»: ты принят(а) в группу. Детали встречи и чат доступны в QUESTR.',
    declined: '«{title}»: твоя заявка отклонена.', removed: '«{title}»: ты больше не в группе.',
    left: 'Квестер покинул вылазку «{title}». Открой QUESTR, чтобы увидеть состав группы.',
    cancelled: 'Вылазка «{title}» отменена. Чат группы закрыт, но прежние сообщения остаются в теме бота.',
    completed: 'Вылазка «{title}» завершена. Чат группы закрыт, но прежние сообщения остаются в теме бота.',
    finishCharacter: 'Открой QUESTR и закончи персонажа, прежде чем присоединяться к вылазке.',
    topicChatLive: '«{title}»\n\nСообщения в этой теме видят принятые участники под твоим именем в QUESTR. Перед отправкой они проходят проверку через OpenRouter на откровенно сексуальный контент. Детали встречи — в QUESTR.',
    topicChatDemo: '«{title}»\n\nСообщения в этой теме видят принятые участники под твоим именем в QUESTR. В локальном демо действует ограниченная проверка текста. Детали встречи — в QUESTR.',
    topicPending: '«{title}»\n\nТвоя заявка ждёт ответа организатора.',
    topicApplyLive: '«{title}»\n\nНапиши короткое сообщение о вылазке для заявки (3–2000 символов, без ссылок и вложений). Перед отправкой организатору оно пройдёт проверку через OpenRouter на откровенно сексуальный контент.',
    topicApplyDemo: '«{title}»\n\nНапиши короткое сообщение о вылазке для заявки (3–2000 символов, без ссылок и вложений). В локальном демо действует ограниченная проверка без ИИ-провайдера.',
    notAccepting: 'На эту вылазку больше не принимают заявки.',
    chooseTopic: 'Открой вылазку в QUESTR и нажми кнопку бота, чтобы выбрать тему.',
    applicationSent: 'Заявка отправлена. Организатор прочитает твоё сообщение и посмотрит персонажа.',
    alreadyPending: 'Твоя заявка уже ждёт ответа организатора.', chatClosed: 'Чат этой группы тебе недоступен.',
    botHelp: 'Открой вылазку в QUESTR и нажми «Подать заявку в боте» или «Открыть чат группы». У каждой вылазки своя закрытая тема.',
    applicationLength: 'Напиши заявку длиной от 3 до 2000 символов.',
    explicitContent: 'Пожалуйста, не добавляй откровенно сексуальный текст в сообщения QUESTR. Лучше напиши о самой вылазке.',
    noLinks: 'Первое сообщение должно быть без ссылок. Ты можешь спросить организатора о вылазке.',
    messageLength: 'Сообщение должно быть короче 3000 символов.',
    unavailable: 'Это действие недоступно. Проверь вылазку и заявку в QUESTR.',
    processingFailed: 'Не удалось обработать сообщение. Попробуй чуть позже.',
    reminder: 'Напоминание: «{title}» начинается {time} ({zone}). Проверь актуальные детали встречи в QUESTR.',
    openButton: 'Открыть QUESTR',
  },
};

export function botText(locale: unknown, key: Key, values: Record<string, string> = {}): string {
  return copy[preferredLocale(locale)][key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}
