// Telegram MarkdownV2 treats these characters as markup even in ordinary text.
const special = /[\\_*\[\]()~`>#+\-=|{}.!]/g;

export function relayMarkdown(author: string, message: string): string {
  const escape = (text: string) => text.replace(special, '\\$&');
  return `*${escape(author)}*:\n${escape(message)}`;
}
